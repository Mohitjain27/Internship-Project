# InternIQ Portal

AI-powered internship marketplace that matches students with employers and uses Google Gemini to automatically screen resumes against a job description.

InternIQ Portal runs as a single self-contained web application: a Python backend serves both the static frontend and a small JSON-based API, while a vanilla HTML, CSS and JavaScript frontend renders two distinct workspaces, one for students and one for employers, from the same codebase.

## Features

**For students**
- Search and filter live internship postings by title, company, skill or location
- Apply with a one-click resume upload (drag-and-drop PDF, up to 5 MB)
- Track every application on a visual timeline (Applied → AI Screened → Shortlisted)
- Get AI-generated feedback per application: match score, justification, matched/missing skills and tailored STAR interview questions
- Practice with an AI Career Coach chatbot, seeded directly from any interview question
- Browse a built-in, searchable interview question bank across five tracks (Frontend, Backend, Data Science/ML, UI/UX Design, Product Management)

**For employers**
- Publish new internship postings through a structured form
- Trigger an AI screening pass over all pending applicants for a posting, with a live progress log
- Review score-ranked candidates in a dashboard with total applicants, screened count and average match score
- Open a full evaluation report per candidate, shortlist or reject directly from the table or the report modal
- Save reports locally and download them as standalone, branded HTML files
- Use an AI Recruitment Assistant chatbot for help framing job descriptions or interview questions

## How it works

1. The browser loads `index.html`, which pulls in `style.css` and `app.js`. `app.js` owns all UI state and talks to the backend through `fetch()` calls to `/api/...` endpoints.
2. `server.py` is a single Python process built on the standard library's `http.server`. It serves the static frontend and also handles the `/api/...` routes as a JSON API.
3. All data (internship postings and applications) lives in two flat JSON files inside a `data/` folder. There is no database.
4. Uploaded resumes are decoded from base64 and written to disk as PDF files inside `data/resumes/`.
5. When an employer runs an AI screen, the backend spins up a background thread that sends each unscored candidate's resume PDF, plus the job description, straight to Gemini (`gemini-2.5-flash`), and asks it to return a structured evaluation (score, justification, matched/missing skills, interview questions) via a Pydantic schema.
6. The frontend polls `/api/status` once a second while screening runs and refreshes automatically once it finishes.
7. A separate AI Career Coach / Recruitment Assistant chatbot, also powered by Gemini, is available in both roles.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3, built on the standard library `http.server` (no Flask, Django or FastAPI) |
| AI | Google Gemini via the `google-genai` SDK, model `gemini-2.5-flash`, for both resume screening and the chatbot |
| Schema validation | Pydantic (`CandidateEvaluation` model) to force Gemini's screening output into structured JSON |
| Frontend | Vanilla HTML, CSS and JavaScript, no framework, no bundler |
| Fonts | Google Fonts: Outfit and Plus Jakarta Sans |
| Data storage | Flat JSON files (`internships.json`, `applications.json`), no database |
| File storage | Resume PDFs stored directly on disk under `data/resumes/` |
| Concurrency | Python `threading` for running the AI screening pipeline in the background |

## Project structure

```
InternIQ_Portal_Project/
├── server.py              
├── .env                   
├── website/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── data/                  
    ├── internships.json
    ├── applications.json
    └── resumes/           
```

## Getting started

**Prerequisites:** Python 3.

1. Install the required packages:
   ```
   pip install google-genai pydantic
   ```
2. Place `index.html`, `style.css` and `app.js` inside a `website/` folder next to `server.py`.
3. Create a `.env` file next to `server.py`:
   ```
   GEMINI_API_KEY=your_key_here
   ```
   Or leave it blank and set the key later from the in-app Settings panel; it gets written back to `.env` automatically.
4. Run the server:
   ```
   python server.py
   ```
5. Open `http://localhost:3000/` in a browser.
6. Sign in with the demo credentials below, or use the "Auto-fill Demo credentials" helper on the login screen.

| Role | Email | Password |
|---|---|---|
| Student | student@interniq.com | student123 |
| Employer | employer@interniq.com | employer123 |

## Environment variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key, used for resume screening and the chatbot. Settable via `.env`, an OS environment variable, or the in-app Settings modal. |

## API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | Current screening pipeline state and Gemini connection status |
| GET | `/api/internships` | All internship postings |
| GET | `/api/applications` | All applications; supports `?internship_id=` to filter |
| GET | `/api/resume?application_id=` | Downloads the resume PDF for an application |
| POST | `/api/save_key` | Saves a Gemini API key in memory and to `.env` |
| POST | `/api/internships` | Publishes a new internship posting |
| POST | `/api/apply` | Submits a new student application |
| POST | `/api/update_status` | Updates an application's status |
| POST | `/api/screen` | Starts the background AI screening pipeline for a posting |
| POST | `/api/chat` | Sends a message to the AI Career Coach / Recruitment Assistant |

## Known limitations

This project is a working prototype, not production-hardened software. Before deploying it anywhere reachable by untrusted users, address the following:

- **No server-side authorization.** Login credentials and role checks live entirely in `app.js`; every `/api/...` endpoint currently accepts requests from anyone regardless of role. A real deployment needs server-side sessions and per-role access control.
- **No database.** `internships.json` and `applications.json` are rewritten wholesale on every write, with no locking, so concurrent writes can race. A real deployment should use a proper database.
- **Minimal filename sanitisation.** Uploaded resume filenames are only lightly cleaned (spaces replaced with underscores) before being written to disk; this should be hardened against path traversal.
- **No automated tests.**
- **Single shared Gemini API key** for the whole app rather than per-user or per-organisation keys.

## Roadmap

- Real authentication with hashed passwords and server-side sessions
- Migrate from flat JSON files to a proper database
- Harden file upload handling (filename sanitisation, virus scanning)
- Add automated tests
- Employer-level analytics and per-organisation API key management

## Acknowledgements

Built with Google's Gemini API (`google-genai`) for AI-based resume screening and the career coaching chatbot, Pydantic for structured AI output validation, and Google Fonts (Outfit, Plus Jakarta Sans) for typography.
