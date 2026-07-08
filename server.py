import http.server
import json
import logging
import os
import sys
import base64
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("InternIQServer")

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RESUMES_DIR = DATA_DIR / "resumes"
WEBSITE_DIR = BASE_DIR / "website"

DATA_DIR.mkdir(exist_ok=True)
RESUMES_DIR.mkdir(exist_ok=True)
WEBSITE_DIR.mkdir(exist_ok=True)

# State
gemini_api_key = os.environ.get("GEMINI_API_KEY", "")
# Try loading API key from local environment if .env exists
env_path = BASE_DIR / ".env"
if env_path.exists():
    try:
        with env_path.open("r") as f:
            for line in f:
                if line.startswith("GEMINI_API_KEY="):
                    gemini_api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception as e:
        logger.error(f"Error loading .env: {e}")

pipeline_state = {
    "running": False,
    "step": "idle",
    "message": "Ready",
    "logs": []
}

def log_pipeline(msg, level="INFO"):
    logger.info(msg)
    pipeline_state["message"] = msg
    pipeline_state["logs"].append(f"{time.strftime('%H:%M:%S')} [{level}] {msg}")

# Background worker for AI screening
def run_screening_worker(internship_id):
    global gemini_api_key
    pipeline_state["running"] = True
    pipeline_state["step"] = "screening"
    pipeline_state["logs"] = []
    
    try:
        log_pipeline(f"Starting AI Screening for Internship ID: {internship_id}")
        
        # Load internships
        internships_file = DATA_DIR / "internships.json"
        if not internships_file.exists():
            raise FileNotFoundError("Internships database not found.")
        with internships_file.open("r", encoding="utf-8") as f:
            internships = json.load(f)
            
        internship = next((i for i in internships if i["id"] == internship_id), None)
        if not internship:
            raise ValueError(f"Internship {internship_id} not found.")

        # Load applications
        apps_file = DATA_DIR / "applications.json"
        if not apps_file.exists():
            apps = []
        else:
            with apps_file.open("r", encoding="utf-8") as f:
                apps = json.load(f)

        unscored_apps = [a for a in apps if a["internship_id"] == internship_id and a.get("score") is None]
        
        if not unscored_apps:
            log_pipeline("No new unscored applications found for this internship.", "WARNING")
            pipeline_state["running"] = False
            pipeline_state["step"] = "idle"
            return

        if not gemini_api_key:
            raise ValueError("Google Gemini API Key is missing. Add it in the settings panel.")

        log_pipeline(f"Found {len(unscored_apps)} applications to screen. Initializing Gemini Client...")
        
        # Import Google GenAI SDK
        from google import genai
        from google.genai import types
        from pydantic import BaseModel, Field

        class CandidateEvaluation(BaseModel):
            score: int = Field(description="Match score from 0 to 100 based on eligibility and skills")
            justification: str = Field(description="Short 2-3 sentence justification explaining the score")
            matched_skills: list[str] = Field(description="Skills from the JD present in candidate's profile")
            missing_skills: list[str] = Field(description="Critical JD skills missing from candidate's profile")
            interview_questions: list[str] = Field(description="3-5 custom STAR interview questions tailored to candidate's missing skills/projects")

        client = genai.Client(api_key=gemini_api_key)

        for idx, app in enumerate(unscored_apps):
            log_pipeline(f"Processing candidate: {app['name']} ({idx+1}/{len(unscored_apps)})")
            
            resume_path = RESUMES_DIR / app["resume_file"]
            if not resume_path.exists():
                log_pipeline(f"Resume file not found for {app['name']}. Skipping.", "WARNING")
                continue
                
            with resume_path.open("rb") as rf:
                pdf_bytes = rf.read()

            log_pipeline(f"Sending resume PDF bytes to Gemini-2.5-Flash for structural analysis...")
            
            prompt = (
                f"Evaluate this candidate against this Internship Posting:\n\n"
                f"Title: {internship['title']}\n"
                f"Company: {internship['company']}\n"
                f"Category: {internship['category']}\n"
                f"Stipend: {internship['stipend']}\n"
                f"Skills required: {', '.join(internship['skills'])}\n"
                f"Description: {internship['description']}\n"
                f"Eligibility: {internship['eligibility']}"
            )

            try:
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        types.Part.from_bytes(
                            data=pdf_bytes,
                            mime_type="application/pdf"
                        ),
                        prompt
                    ],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=CandidateEvaluation,
                        system_instruction="You are an expert HR recruitment assistant evaluating student resumes for internship applications. Assign scores objectively based on alignment of skills, projects, education, and eligibility criteria."
                    )
                )
                
                eval_data = json.loads(response.text)
                score = eval_data.get("score", 0)
                
                app["score"] = score
                app["justification"] = eval_data.get("justification", "No justification provided.")
                app["matched_skills"] = eval_data.get("matched_skills", [])
                app["missing_skills"] = eval_data.get("missing_skills", [])
                app["interview_questions"] = eval_data.get("interview_questions", [])
                app["status"] = "Shortlisted" if score >= 60 else "Under Review"
                
                log_pipeline(f"Candidate {app['name']} scored successfully: {score}/100")

            except Exception as ex:
                log_pipeline(f"Failed to score candidate {app['name']}: {ex}", "ERROR")
                app["score"] = 0
                app["justification"] = f"Evaluation failed: {ex}"
                app["matched_skills"] = []
                app["missing_skills"] = []
                app["status"] = "Error"
                
            # Save progress incrementally
            with apps_file.open("w", encoding="utf-8") as wf:
                json.dump(apps, wf, indent=2)
                
        log_pipeline("AI Screening complete! All candidates processed successfully.", "SUCCESS")
        
    except Exception as e:
        log_pipeline(f"Screening pipeline error: {e}", "ERROR")
    finally:
        pipeline_state["running"] = False
        pipeline_state["step"] = "idle"

class InternIQRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEBSITE_DIR), **kwargs)

    def end_headers(self):
        # Disable cache for development
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        # ── API ENDPOINTS ──
        if path == "/api/status":
            self.send_json(200, {
                "running": pipeline_state["running"],
                "step": pipeline_state["step"],
                "message": pipeline_state["message"],
                "logs": pipeline_state["logs"],
                "api_key_connected": bool(gemini_api_key)
            })
            return

        if path == "/api/internships":
            internships_file = DATA_DIR / "internships.json"
            if internships_file.exists():
                with internships_file.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                data = []
            self.send_json(200, data)
            return

        if path == "/api/applications":
            apps_file = DATA_DIR / "applications.json"
            if apps_file.exists():
                with apps_file.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                data = []
            
            # Optional filter by internship_id
            int_id = query.get("internship_id", [None])[0]
            if int_id:
                data = [a for a in data if a["internship_id"] == int_id]
            self.send_json(200, data)
            return

        if path == "/api/resume":
            app_id = query.get("application_id", [None])[0]
            if not app_id:
                self.send_error(400, "Missing application_id.")
                return

            apps_file = DATA_DIR / "applications.json"
            if not apps_file.exists():
                self.send_error(404, "No applications database found.")
                return

            with apps_file.open("r", encoding="utf-8") as f:
                apps = json.load(f)

            app = next((a for a in apps if a["id"] == app_id), None)
            if not app or not app.get("resume_file"):
                self.send_error(404, "Resume file not found.")
                return

            resume_path = RESUMES_DIR / app["resume_file"]
            if not resume_path.exists():
                self.send_error(404, "Resume file not found on disk.")
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", f'attachment; filename="{app["resume_file"]}"')
            self.send_header("Content-Length", str(resume_path.stat().st_size))
            self.end_headers()

            with resume_path.open("rb") as f:
                self.wfile.write(f.read())
            return

        # Fallback to serving static files from WEBSITE_DIR
        super().do_GET()

    def do_POST(self):
        global gemini_api_key
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        if path == "/api/save_key":
            payload = self.read_json_payload()
            key = payload.get("api_key", "").strip()
            gemini_api_key = key
            
            # Save to local .env file
            try:
                with env_path.open("w") as f:
                    f.write(f"GEMINI_API_KEY={key}\n")
            except Exception as e:
                logger.error(f"Failed to write .env: {e}")
                
            self.send_json(200, {"status": "success", "message": "API key saved."})
            return

        if path == "/api/internships":
            payload = self.read_json_payload()
            
            internships_file = DATA_DIR / "internships.json"
            if internships_file.exists():
                with internships_file.open("r", encoding="utf-8") as f:
                    internships = json.load(f)
            else:
                internships = []

            new_internship = {
                "id": f"int_{int(time.time())}",
                "title": payload.get("title", "Untitled Role"),
                "company": payload.get("company", "Nexus Analytics"),
                "category": payload.get("category", "General"),
                "location": payload.get("location", "Office"),
                "duration": payload.get("duration", "3 Months"),
                "stipend": payload.get("stipend", "₹15,000 / month"),
                "skills": payload.get("skills", []),
                "description": payload.get("description", ""),
                "eligibility": payload.get("eligibility", ""),
                "posted_at": time.strftime('%Y-%m-%d')
            }

            internships.append(new_internship)
            with internships_file.open("w", encoding="utf-8") as f:
                json.dump(internships, f, indent=2)

            self.send_json(200, {"status": "success", "data": new_internship})
            return

        if path == "/api/apply":
            payload = self.read_json_payload()
            
            int_id = payload.get("internship_id")
            name = payload.get("name")
            email = payload.get("email")
            resume_base64 = payload.get("resume_base64")
            resume_name = payload.get("resume_name", "resume.pdf")

            if not int_id or not name or not email or not resume_base64:
                self.send_json(400, {"status": "error", "message": "Missing required fields."})
                return

            # Save resume PDF
            app_id = f"app_{int(time.time() * 1000)}"
            resume_filename = f"{app_id}_{resume_name.replace(' ', '_')}"
            resume_path = RESUMES_DIR / resume_filename

            try:
                pdf_bytes = base64.b64decode(resume_base64)
                with resume_path.open("wb") as f:
                    f.write(pdf_bytes)
            except Exception as e:
                self.send_json(500, {"status": "error", "message": f"Failed to save resume file: {e}"})
                return

            # Append application record
            apps_file = DATA_DIR / "applications.json"
            if apps_file.exists():
                with apps_file.open("r", encoding="utf-8") as f:
                    apps = json.load(f)
            else:
                apps = []

            new_app = {
                "id": app_id,
                "internship_id": int_id,
                "name": name,
                "email": email,
                "resume_file": resume_filename,
                "status": "Applied",
                "applied_at": time.strftime('%Y-%m-%d %H:%M:%S'),
                "score": None,
                "justification": None,
                "matched_skills": [],
                "missing_skills": []
            }

            apps.append(new_app)
            with apps_file.open("w", encoding="utf-8") as f:
                json.dump(apps, f, indent=2)

            self.send_json(200, {"status": "success", "data": new_app})
            return

        if path == "/api/update_status":
            payload = self.read_json_payload()
            app_id = payload.get("application_id")
            new_status = payload.get("status")

            if not app_id or not new_status:
                self.send_json(400, {"status": "error", "message": "Missing required fields."})
                return

            apps_file = DATA_DIR / "applications.json"
            if apps_file.exists():
                with apps_file.open("r", encoding="utf-8") as f:
                    apps = json.load(f)
            else:
                apps = []

            updated = False
            for app in apps:
                if app["id"] == app_id:
                    app["status"] = new_status
                    updated = True
                    break

            if not updated:
                self.send_json(404, {"status": "error", "message": "Application not found."})
                return

            with apps_file.open("w", encoding="utf-8") as f:
                json.dump(apps, f, indent=2)

            self.send_json(200, {"status": "success", "message": f"Status updated to {new_status}."})
            return

        if path == "/api/screen":
            if pipeline_state["running"]:
                self.send_json(400, {"status": "error", "message": "Screening is already running."})
                return

            payload = self.read_json_payload()
            int_id = payload.get("internship_id")
            if not int_id:
                self.send_json(400, {"status": "error", "message": "Missing internship_id."})
                return

            # Start worker thread
            threading.Thread(target=run_screening_worker, args=(int_id,), daemon=True).start()
            self.send_json(200, {"status": "success", "message": "Screening pipeline started in background."})
            return

        if path == "/api/chat":
            payload = self.read_json_payload()
            user_msg = payload.get("message", "")
            history = payload.get("history", [])
            context = payload.get("context", {})

            if not user_msg:
                self.send_json(400, {"status": "error", "message": "Missing message."})
                return

            if not gemini_api_key:
                self.send_json(200, {
                    "status": "success",
                    "reply": "I am currently offline because the Google Gemini API key is missing. Please save a key in the settings panel."
                })
                return

            try:
                from google import genai
                from google.genai import types

                client = genai.Client(api_key=gemini_api_key)
                
                contents = []
                for h in history:
                    contents.append(
                        types.Content(
                            role=h["role"],
                            parts=[types.Part.from_text(text=h["text"])]
                        )
                    )
                contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part.from_text(text=user_msg)]
                    )
                )

                role_type = context.get("role", "student")
                if role_type == "employer":
                    system_instruction = (
                        "You are the InternIQ Recruitment Coach, an elite AI HR advisor helping employers source, screen, and select candidate resumes.\n"
                        "Provide professional and actionable advice on evaluating candidates, framing STAR interview questions, and onboarding talent. Keep response brief."
                    )
                else:
                    skills_str = ", ".join(context.get("target_skills", []))
                    system_instruction = (
                        f"You are the InternIQ Career Coach, a helpful and elite HR counselor. "
                        f"You are advising a student to help them land an internship.\n"
                        f"Candidate context:\n"
                        f"- Recent application score: {context.get('last_app_score', 'N/A')}/100.\n"
                        f"- Key target skills: {skills_str}.\n\n"
                        f"Provide actionable career, projects, and learning advice in a brief, encouraging tone. Keep formatting neat."
                    )

                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction
                    )
                )

                self.send_json(200, {
                    "status": "success",
                    "reply": response.text
                })
            except Exception as e:
                logger.error(f"Chat API error: {e}")
                self.send_json(200, {
                    "status": "error",
                    "reply": f"Sorry, I encountered an issue processing your request: {e}"
                })
            return

        self.send_response(404)
        self.end_headers()

    def send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def read_json_payload(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            return json.loads(body.decode('utf-8'))
        except Exception:
            return {}

def run_server():
    port = 3000
    server_address = ('', port)
    httpd = http.server.HTTPServer(server_address, InternIQRequestHandler)
    logger.info(f"InternIQ Server running at http://localhost:{port}/")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Stopping server...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
