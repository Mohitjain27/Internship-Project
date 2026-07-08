// ─────────────────────────────────────────────
// InternIQ — app.js
// ─────────────────────────────────────────────

const state = {
  mode: 'student', // 'student' | 'employer'
  studentView: 'search', // 'search' | 'applications'
  employerView: 'roles', // 'roles' | 'post'
  internships: [],
  applications: [],
  apiKey: localStorage.getItem('interniq_api_key') || '',
  selectedInternshipForApply: null,
  selectedResumeBase64: '',
  selectedResumeName: '',
  pollTimer: null
};

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkLoginState();
  initDragAndDrop();
  restoreState();
  fetchInitialData();
  
  if (state.apiKey) {
    document.getElementById('api-key-input').value = state.apiKey;
    updateApiKeyIndicator(true);
    syncKeyWithBackend(state.apiKey);
  }
});

function restoreState() {
  const savedMode = localStorage.getItem('interniq_portal_mode') || 'student';
  togglePortalMode(savedMode);
}

function fetchInitialData() {
  fetch('/api/internships')
    .then(r => r.json())
    .then(data => {
      state.internships = data;
      renderInternshipsList();
      populateEmployerRoleDropdown();
    })
    .catch(err => console.error("Error loading internships:", err));

  fetch('/api/applications')
    .then(r => r.json())
    .then(data => {
      state.applications = data;
      renderStudentApplications();
      loadEmployerRoleApplicants();
    })
    .catch(err => console.error("Error loading applications:", err));

  // Check general pipeline status
  checkPipelineStatus();
}

// ─────────────────────────────────────────────
// PORTAL MODE & VIEW TOGGLING
// ─────────────────────────────────────────────
function togglePortalMode(mode) {
  state.mode = mode;
  localStorage.setItem('interniq_portal_mode', mode);

  // Buttons toggle
  const modeBtn = document.getElementById(`mode-btn-${mode}`);
  if (modeBtn) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    modeBtn.classList.add('active');
  }

  // Sync Chatbot Persona Greetings
  const chatMsgBox = document.getElementById('chat-messages-box');
  if (chatMsgBox) {
    chatMsgBox.innerHTML = mode === 'student' ? `
      <div class="chat-message bot">
        Hi there! I am your InternIQ Career Coach. Ask me how to bridge your skills gap, improve your resume, or prepare for mock interviews!
      </div>
    ` : `
      <div class="chat-message bot">
        Hello! I am your InternIQ Recruitment Assistant. Ask me how to filter candidates, frame interview questions, or write perfect job descriptions!
      </div>
    `;
  }

  // Sidebars toggle
  if (mode === 'student') {
    document.getElementById('sidebar-student').style.display = 'flex';
    document.getElementById('sidebar-employer').style.display = 'none';
    document.getElementById('portal-student').style.display = 'block';
    document.getElementById('portal-employer').style.display = 'none';
    
    const trigger = document.getElementById('chat-trigger');
    if (trigger) trigger.style.display = 'flex';
    
    switchStudentView(state.studentView);
  } else {
    document.getElementById('sidebar-student').style.display = 'none';
    document.getElementById('sidebar-employer').style.display = 'flex';
    document.getElementById('portal-student').style.display = 'none';
    document.getElementById('portal-employer').style.display = 'block';
    
    const trigger = document.getElementById('chat-trigger');
    if (trigger) trigger.style.display = 'flex'; // Keep chat trigger visible for Employers
    
    const drawer = document.getElementById('chat-drawer');
    if (drawer) drawer.classList.remove('open');
    
    switchEmployerView(state.employerView);
    populateEmployerRoleDropdown();
  }
}

function switchStudentView(view) {
  state.studentView = view;
  document.querySelectorAll('#sidebar-student .nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('#portal-student .view').forEach(v => v.classList.remove('active'));

  if (view === 'search') {
    document.getElementById('nav-stud-search').classList.add('active');
    document.getElementById('view-stud-search').classList.add('active');
    renderInternshipsList();
  } else if (view === 'applications') {
    document.getElementById('nav-stud-apps').classList.add('active');
    document.getElementById('view-stud-applications').classList.add('active');
    renderStudentApplications();
  } else if (view === 'prep') {
    document.getElementById('nav-stud-prep').classList.add('active');
    document.getElementById('view-stud-prep').classList.add('active');
    renderPrepPortal();
  }
}

function switchEmployerView(view) {
  state.employerView = view;
  document.querySelectorAll('#sidebar-employer .nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('#portal-employer .view').forEach(v => v.classList.remove('active'));

  if (view === 'roles') {
    document.getElementById('nav-emp-roles').classList.add('active');
    document.getElementById('view-emp-roles').classList.add('active');
    loadEmployerRoleApplicants();
  } else if (view === 'saved') {
    document.getElementById('nav-emp-saved').classList.add('active');
    document.getElementById('view-emp-saved').classList.add('active');
    renderSavedReports();
  } else {
    document.getElementById('nav-emp-post').classList.add('active');
    document.getElementById('view-emp-post').classList.add('active');
  }
}

// ─────────────────────────────────────────────
// STUDENT MODULE: FIND INTERNSHIPS
// ─────────────────────────────────────────────
function renderInternshipsList() {
  const container = document.getElementById('internships-list');
  if (!container) return;

  const search = document.getElementById('search-input').value.toLowerCase();
  const location = document.getElementById('location-filter').value;

  const filtered = state.internships.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(search) || 
                          item.company.toLowerCase().includes(search) ||
                          item.skills.some(s => s.toLowerCase().includes(search));
    
    let matchesLocation = true;
    if (location === 'remote') {
      matchesLocation = item.location.toLowerCase().includes('remote');
    } else if (location === 'office') {
      matchesLocation = !item.location.toLowerCase().includes('remote');
    }

    return matchesSearch && matchesLocation;
  });

  document.getElementById('internship-count').textContent = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-2);">
        🔍 No matching internships found. Try adjusting your query filters.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    // Check if student already applied to this internship
    const alreadyApplied = state.applications.some(a => a.internship_id === item.id);
    
    return `
      <div class="internship-card">
        <div>
          <div class="card-header-row">
            <div>
              <h3 class="card-title">${item.title}</h3>
              <div class="card-company">${item.company}</div>
            </div>
            <span class="card-stipend-badge">${item.stipend}</span>
          </div>
          
          <div class="card-meta-wrap" style="margin-top: 10px;">
            <div class="card-meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>${item.location}</span>
            </div>
            <div class="card-meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>${item.duration}</span>
            </div>
          </div>

          <div style="font-size:0.8rem;color:var(--text-2);margin-top:0.8rem;line-height:1.4;">
            ${item.description.length > 120 ? item.description.substring(0, 120) + '...' : item.description}
          </div>
        </div>

        <div>
          <div class="card-skills-wrap" style="margin-bottom: 1.2rem;">
            ${item.skills.map(s => `<span class="skill-chip">${s}</span>`).join('')}
          </div>
          
          ${alreadyApplied ? 
            `<button class="btn-ghost" style="width:100%;cursor:default;opacity:0.8;color:var(--green);border-color:rgba(16,185,129,0.3);" disabled>✓ Applied</button>` : 
            `<button class="btn-primary" style="width:100%;" onclick="openApplyModal('${item.id}')">Apply Now</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function filterInternships() {
  renderInternshipsList();
}

// ─────────────────────────────────────────────
// STUDENT MODULE: MY APPLICATIONS (TIMELINE)
// ─────────────────────────────────────────────
function renderStudentApplications() {
  const container = document.getElementById('student-apps-container');
  if (!container) return;

  if (state.applications.length === 0) {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 4rem; color: var(--text-2);">
        📁 You haven't applied to any internships yet. Go find some matches!
      </div>
    `;
    return;
  }

  container.innerHTML = state.applications.map(app => {
    const internship = state.internships.find(i => i.id === app.internship_id) || {
      title: "Unknown Internship",
      company: "Unknown Company",
      stipend: "N/A"
    };

    const isApplied = true;
    const isReviewed = app.status !== 'Applied' && app.status !== 'Error';
    const isShortlisted = app.status === 'Shortlisted';
    
    // Timeline steps layout
    let timelineHtml = `
      <div class="app-timeline">
        <div class="timeline-step completed">
          <div class="step-dot">1</div>
          <span class="step-label">Applied</span>
        </div>
        <div class="timeline-step ${isReviewed ? 'completed' : 'active'}">
          <div class="step-dot">2</div>
          <span class="step-label">AI Screened</span>
        </div>
        <div class="timeline-step ${isShortlisted ? 'completed' : ''}">
          <div class="step-dot">3</div>
          <span class="step-label">Shortlisted</span>
        </div>
      </div>
    `;

    // AI feedback block
    let feedbackHtml = '';
    if (app.score !== null) {
      let interviewHtml = '';
      if (app.interview_questions && app.interview_questions.length > 0) {
        interviewHtml = `
          <div style="margin-top:1.25rem; border-top:1px solid var(--border-2); padding-top:1rem;">
            <div style="font-size:0.75rem; font-weight:700; color:var(--purple); margin-bottom:6px;">💡 Suggested Practice Interview Questions</div>
            <ul class="questions-list" style="margin-top:4px;">
              ${app.interview_questions.map(q => `
                <li style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
                  <span>${q}</span>
                  <button class="btn-ghost" style="padding:2px 8px; font-size:0.7rem; margin-top:2px; display:inline-flex; align-items:center; gap:2px;" onclick="startMockPrep('${q.replace(/'/g, "\\'")}')">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Practice with Coach
                  </button>
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      feedbackHtml = `
        <div style="margin-top:1.5rem;padding:1.25rem;background:rgba(255,255,255,0.02);border:1px solid var(--border-2);border-radius:var(--radius-sm);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
            <div style="font-weight:700;color:white;font-size:0.9rem;">🤖 AI Evaluator Feedback</div>
            <div class="score-badge ${app.score >= 70 ? 'strong' : app.score >= 50 ? 'moderate' : 'weak'}">Score: ${app.score}%</div>
          </div>
          <p style="font-size:0.85rem;color:var(--text-2);line-height:1.4;margin-bottom:0.75rem;">${app.justification}</p>
          
          <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
            ${app.matched_skills.length > 0 ? `
              <div>
                <div style="font-size:0.75rem;font-weight:700;color:var(--green);margin-bottom:4px;">Matched Skills</div>
                <div class="card-skills-wrap">
                  ${app.matched_skills.map(s => `<span class="skill-chip matched">${s}</span>`).join('')}
                </div>
              </div>
            ` : ''}
            
            ${app.missing_skills.length > 0 ? `
              <div>
                <div style="font-size:0.75rem;font-weight:700;color:var(--red);margin-bottom:4px;">Skills to Learn</div>
                <div class="card-skills-wrap">
                  ${app.missing_skills.map(s => `<span class="skill-chip missing">${s}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>
          
          ${interviewHtml}
        </div>
      `;
    }

    return `
      <div class="app-card">
        <div class="app-card-header">
          <div>
            <h3 style="font-size:1.15rem;color:white;margin-bottom:4px;">${internship.title}</h3>
            <div style="font-size:0.85rem;color:var(--text-2);">${internship.company} · ${internship.stipend}</div>
          </div>
          <span class="app-status-badge ${app.status.toLowerCase().replace(' ', '_')}">${app.status}</span>
        </div>
        
        ${timelineHtml}
        ${feedbackHtml}
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────
// STUDENT APPLY MODAL & RESUME HANDLERS
// ─────────────────────────────────────────────
function openApplyModal(id) {
  const item = state.internships.find(i => i.id === id);
  if (!item) return;

  state.selectedInternshipForApply = item;
  state.selectedResumeBase64 = '';
  state.selectedResumeName = '';

  document.getElementById('app-modal-sub').textContent = `${item.title} at ${item.company}`;
  document.getElementById('app-modal').style.display = 'flex';
  
  // Reset fields
  document.getElementById('app-name').value = '';
  document.getElementById('app-email').value = '';
  document.getElementById('file-selected-badge').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'block';
}

function closeModal(e) {
  if (e.target.className === 'modal-overlay') {
    closeModalDirect();
  }
}

function closeModalDirect() {
  document.getElementById('app-modal').style.display = 'none';
  state.selectedInternshipForApply = null;
}

function initDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  dropZone.addEventListener('click', () => document.getElementById('file-input').click());
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processSelectedFile(files[0]);
    }
  });
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    processSelectedFile(files[0]);
  }
}

function processSelectedFile(file) {
  if (file.type !== 'application/pdf') {
    showToast('Invalid file format. Please upload a PDF resume.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('File is too large (max 5MB)', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function() {
    state.selectedResumeBase64 = reader.result.split(',')[1];
    state.selectedResumeName = file.name;
    
    // Update UI badge
    document.getElementById('drop-zone').style.display = 'none';
    const badge = document.getElementById('file-selected-badge');
    badge.style.display = 'block';
    badge.innerHTML = `
      <div class="file-selected-card">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span style="font-weight:600;color:white;">${file.name}</span>
          <span style="color:var(--text-3);">(${(file.size/1024).toFixed(1)} KB)</span>
        </div>
        <button onclick="removeSelectedFile()" style="background:none;border:none;color:var(--text-3);cursor:pointer;font-weight:bold;font-size:0.95rem;">✕</button>
      </div>
    `;
  };
  reader.readAsDataURL(file);
}

function removeSelectedFile() {
  state.selectedResumeBase64 = '';
  state.selectedResumeName = '';
  document.getElementById('file-selected-badge').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'block';
}

function submitApplication() {
  const name = document.getElementById('app-name').value.trim();
  const email = document.getElementById('app-email').value.trim();
  const btn = document.getElementById('btn-submit-app');

  if (!name || !email) {
    showToast('Please enter your Name and Email.', 'error');
    return;
  }
  if (!state.selectedResumeBase64) {
    showToast('Please upload your resume PDF.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const payload = {
    internship_id: state.selectedInternshipForApply.id,
    name,
    email,
    resume_name: state.selectedResumeName,
    resume_base64: state.selectedResumeBase64
  };

  fetch('/api/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(res => {
    btn.disabled = false;
    btn.textContent = 'Submit Application';
    
    if (res.status === 'success') {
      showToast('Application submitted successfully!', 'success');
      closeModalDirect();
      fetchInitialData(); // Reload listings & dashboard
    } else {
      showToast(res.message || 'Submission failed.', 'error');
    }
  })
  .catch(err => {
    btn.disabled = false;
    btn.textContent = 'Submit Application';
    console.error("Apply error:", err);
    showToast('Network error during application submission', 'error');
  });
}

// ─────────────────────────────────────────────
// EMPLOYER MODULE: MANAGE APPLICANTS & AI SCREEN
// ─────────────────────────────────────────────
function populateEmployerRoleDropdown() {
  const select = document.getElementById('emp-role-select');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = state.internships.map(i => `
    <option value="${i.id}">${i.title} (${i.company})</option>
  `).join('');

  if (currentVal && state.internships.some(i => i.id === currentVal)) {
    select.value = currentVal;
  } else if (state.internships.length > 0) {
    select.value = state.internships[0].id;
  }
  loadEmployerRoleApplicants(); // Explicitly load applicant details to sync table
}

function loadEmployerRoleApplicants() {
  const roleSelect = document.getElementById('emp-role-select');
  const tbody = document.getElementById('employer-applicants-list');
  if (!roleSelect || !tbody) return;

  const intId = roleSelect.value;
  if (!intId) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No postings available.</td></tr>';
    return;
  }

  const matches = state.applications.filter(a => a.internship_id === intId);

  // Compute stats
  const total = matches.length;
  const screened = matches.filter(a => a.score !== null).length;
  const avg = screened > 0 ? Math.round(matches.reduce((acc, curr) => acc + (curr.score || 0), 0) / screened) : 0;

  document.getElementById('stat-total-apps').textContent = total;
  document.getElementById('stat-screened-apps').textContent = screened;
  document.getElementById('stat-average-score').textContent = `${avg}%`;

  if (matches.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;color:var(--text-3);padding:2rem;">
          No candidates have applied to this posting yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = matches.map(app => {
    const scoreVal = app.score !== null ? `${app.score}%` : 'Pending';
    const scoreClass = app.score !== null ? (app.score >= 70 ? 'strong' : app.score >= 50 ? 'moderate' : 'weak') : 'weak';
    
    return `
      <tr>
        <td style="font-weight:600;color:white;">${app.name}</td>
        <td>${app.email}</td>
        <td>${app.applied_at.substring(0, 10)}</td>
        <td>
          <span class="score-badge ${scoreClass}">${scoreVal}</span>
        </td>
        <td>
          <span class="app-status-badge ${app.status.toLowerCase().replace(' ', '_')}">${app.status}</span>
        </td>
        <td>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            ${app.score !== null ? 
              `<button class="btn-ghost" style="padding:4px 10px;font-size:0.75rem;" onclick="openEvalReport('${app.id}')">View Report</button>` : 
              `<span style="color:var(--text-3);font-size:0.8rem;">Run screen first</span>`
            }
            ${app.score !== null && app.status === 'Under Review' ? `
              <button class="btn-ghost" style="padding:4px 10px;font-size:0.75rem; color:var(--green); border-color:rgba(16,185,129,0.3); background:rgba(16,185,129,0.03);" onclick="updateApplicantStatus('${app.id}', 'Shortlisted')">Shortlist</button>
              <button class="btn-ghost" style="padding:4px 10px;font-size:0.75rem; color:var(--red); border-color:rgba(239,68,68,0.3); background:rgba(239,68,68,0.03);" onclick="updateApplicantStatus('${app.id}', 'Rejected')">Reject</button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function triggerAIScreening() {
  const intId = document.getElementById('emp-role-select').value;
  if (!intId) return;

  const btn = document.getElementById('btn-screen');
  btn.disabled = true;

  fetch('/api/screen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ internship_id: intId })
  })
  .then(r => r.json())
  .then(res => {
    if (res.status === 'success') {
      showToast('AI screening pipeline started successfully!', 'success');
      document.getElementById('pipeline-progress').style.display = 'block';
      startPollingPipeline();
    } else {
      showToast(res.message || 'Pipeline failed to start', 'error');
      btn.disabled = false;
    }
  })
  .catch(err => {
    console.error("Pipeline start error:", err);
    showToast('Failed to connect to Python backend API.', 'error');
    btn.disabled = false;
  });
}

function startPollingPipeline() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(checkPipelineStatus, 1000);
}

function checkPipelineStatus() {
  fetch('/api/status')
    .then(r => r.json())
    .then(res => {
      // Update sidebar status
      updateApiKeyIndicator(res.api_key_connected);

      if (res.running) {
        document.getElementById('pipeline-progress').style.display = 'block';
        document.getElementById('pipeline-status-step').textContent = res.message;
        document.getElementById('btn-screen').disabled = true;
        
        // Render logs
        const logsBox = document.getElementById('pipeline-logs-box');
        if (logsBox) {
          logsBox.innerHTML = res.logs.map(l => `<div>${l}</div>`).join('');
          logsBox.scrollTop = logsBox.scrollHeight;
        }
      } else {
        if (state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          document.getElementById('pipeline-progress').style.display = 'none';
          document.getElementById('btn-screen').disabled = false;
          // Reload state
          fetchInitialData();
        }
      }
    })
    .catch(() => {});
}

// ─────────────────────────────────────────────
// EVALUATION DETAIL REPORT
// ─────────────────────────────────────────────
function openEvalReport(appId) {
  const app = state.applications.find(a => a.id === appId);
  if (!app) return;

  const container = document.getElementById('eval-modal-body');
  document.getElementById('eval-modal-sub').textContent = `Candidate name: ${app.name} (${app.email})`;

  let interviewHtml = '';
  if (app.interview_questions && app.interview_questions.length > 0) {
    interviewHtml = `
      <div style="margin-top:1.25rem; border-top:1px solid var(--border-2); padding-top:1.25rem;">
        <h4 style="font-size:0.9rem; color:var(--purple); margin-bottom:6px;">Tailored STAR Interview Questions</h4>
        <ul class="questions-list">
          ${app.interview_questions.map(q => `<li>${q}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:1.25rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:1.25rem; border-radius:var(--radius-sm); border:1px solid var(--border-2); flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:0.9rem; font-weight:700; color:white;">AI Candidate Scoring Fit</div>
          <div class="score-badge ${app.score >= 70 ? 'strong' : app.score >= 50 ? 'moderate' : 'weak'}" style="font-size:1rem; padding:6px 12px; margin-top:6px;">${app.score}% Fit</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <button class="btn-ghost" style="padding:6px 12px; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;" onclick="saveReportToLocal('${app.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save to Local
          </button>
          <button class="btn-ghost" style="padding:6px 12px; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;" onclick="printEvalReport()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>
            Download File
          </button>
        </div>
      </div>

      <div>
        <h4 style="font-size:0.9rem; color:var(--purple); margin-bottom:4px;">Evaluation Justification</h4>
        <p style="font-size:0.85rem; color:var(--text-2); line-height:1.45;">${app.justification}</p>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.2rem;">
        <div>
          <h4 style="font-size:0.85rem; color:var(--green); margin-bottom:6px;">Matched Skills</h4>
          <div class="card-skills-wrap">
            ${app.matched_skills.length > 0 ? 
              app.matched_skills.map(s => `<span class="skill-chip matched">${s}</span>`).join('') :
              `<span style="font-size:0.75rem; color:var(--text-3);">None identified</span>`
            }
          </div>
        </div>
        
        <div>
          <h4 style="font-size:0.85rem; color:var(--red); margin-bottom:6px;">Missing / Missing Prerequisites</h4>
          <div class="card-skills-wrap">
            ${app.missing_skills.length > 0 ? 
              app.missing_skills.map(s => `<span class="skill-chip missing">${s}</span>`).join('') :
              `<span style="font-size:0.75rem; color:var(--text-3);">None identified</span>`
            }
          </div>
        </div>
      </div>
      
      ${interviewHtml}

      ${app.status === 'Under Review' ? `
        <div style="margin-top:1.5rem; border-top:1px solid var(--border-2); padding-top:1.25rem; display:flex; gap:12px; justify-content:flex-end; flex-wrap:wrap;">
          <button class="btn-ghost" style="padding:8px 16px; font-size:0.85rem; color:var(--red); border-color:rgba(239,68,68,0.4);" onclick="updateApplicantStatusFromModal('${app.id}', 'Rejected')">❌ Reject Candidate</button>
          <button class="btn" style="padding:8px 16px; font-size:0.85rem; background:var(--purple); border-color:var(--purple); color:white;" onclick="updateApplicantStatusFromModal('${app.id}', 'Shortlisted')">✅ Shortlist Candidate</button>
        </div>
      ` : `
        <div style="margin-top:1.5rem; border-top:1px solid var(--border-2); padding-top:1.25rem; text-align:right; font-size:0.85rem; color:var(--text-2);">
          Application Status: <span class="app-status-badge ${app.status.toLowerCase().replace(' ', '_')}">${app.status}</span>
        </div>
      `}
    </div>
  `;

  document.getElementById('eval-modal').style.display = 'flex';
}

function closeEvalModal(e) {
  if (e.target.className === 'modal-overlay') {
    closeEvalModalDirect();
  }
}
function closeEvalModalDirect() {
  document.getElementById('eval-modal').style.display = 'none';
}

// ─────────────────────────────────────────────
// EMPLOYER MODULE: DOWNLOAD EVALUATION REPORT
// ─────────────────────────────────────────────
function printEvalReport() {
  // Find the currently open application via the subtitle
  const subtitle = document.getElementById('eval-modal-sub').textContent;
  // Extract email from subtitle: "Candidate name: NAME (email)"
  const emailMatch = subtitle.match(/\(([^)]+)\)/);
  if (!emailMatch) { showToast('Could not identify candidate.', 'error'); return; }
  const email = emailMatch[1];
  const app = state.applications.find(a => a.email === email);
  if (!app) { showToast('Application data not found.', 'error'); return; }

  const internship = state.internships.find(i => i.id === app.internship_id) || { title: 'Unknown Role', company: 'Unknown Company' };
  const scoreBadgeColor = app.score >= 70 ? '#10b981' : app.score >= 50 ? '#f59e0b' : '#ef4444';
  const questionsHtml = app.interview_questions && app.interview_questions.length > 0
    ? `<h3 style="color:#818cf8; font-size:14px; margin: 24px 0 8px;">Tailored STAR Interview Questions</h3>
       <ol style="margin:0; padding-left:18px; color:#94a3b8; font-size:13px; line-height:1.7;">
         ${app.interview_questions.map(q => `<li>${q}</li>`).join('')}
       </ol>`
    : '';

  const matchedSkillsHtml = app.matched_skills.length > 0
    ? app.matched_skills.map(s => `<span style="display:inline-block; background:#0d2a1f; border:1px solid #10b981; color:#10b981; border-radius:4px; padding:2px 8px; font-size:11px; margin:2px;">${s}</span>`).join('')
    : '<span style="color:#64748b; font-size:12px;">None identified</span>';

  const missingSkillsHtml = app.missing_skills.length > 0
    ? app.missing_skills.map(s => `<span style="display:inline-block; background:#2a0d0d; border:1px solid #ef4444; color:#ef4444; border-radius:4px; padding:2px 8px; font-size:11px; margin:2px;">${s}</span>`).join('')
    : '<span style="color:#64748b; font-size:12px;">None identified</span>';

  const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>InternIQ Evaluation Report — ${app.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Outfit', sans-serif; background: #f8fafc; color: #1e293b; padding: 48px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; margin-bottom: 24px; }
    .logo { font-size: 24px; font-weight: 800; color: #6366f1; }
    .logo span { color: #22c55e; }
    .meta { font-size: 12px; color: #64748b; text-align: right; line-height: 1.7; }
    h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    .candidate-info { font-size: 13px; color: #475569; margin-bottom: 24px; }
    .score-card { display: flex; justify-content: space-between; align-items: center; background: #f1f5f9; border-radius: 10px; padding: 16px 20px; border-left: 4px solid ${scoreBadgeColor}; margin-bottom: 20px; }
    .score-card .label { font-weight: 700; font-size: 14px; color: #0f172a; }
    .score-badge { font-size: 22px; font-weight: 800; color: ${scoreBadgeColor}; }
    .section { margin-bottom: 20px; }
    .section h3 { font-size: 13px; font-weight: 700; color: #6366f1; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
    .justification { font-size: 13px; color: #475569; line-height: 1.6; background: #f8fafc; border-radius: 8px; padding: 14px; border: 1px solid #e2e8f0; }
    .skills-grid { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; }
    .skills-col { flex: 1; min-width: 200px; }
    .skills-col h3 { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
    .status-box { margin-top: 20px; font-size: 13px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 16px; display: flex; justify-content: space-between; }
    .status-chip { font-weight: 700; font-size: 13px; padding: 4px 12px; border-radius: 20px; }
    .status-shortlisted { background:#d1fae5; color:#065f46; }
    .status-rejected { background:#fee2e2; color:#991b1b; }
    .status-under_review { background:#fef3c7; color:#92400e; }
    .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Intern<span>IQ</span></div>
      <div style="font-size:12px; color:#64748b; margin-top:2px;">AI-Powered Internship Portal</div>
    </div>
    <div class="meta">
      <div><strong>Report Generated:</strong> ${new Date().toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short' })}</div>
      <div><strong>Role:</strong> ${internship.title}</div>
      <div><strong>Company:</strong> ${internship.company}</div>
    </div>
  </div>

  <h1>AI Candidate Evaluation Report</h1>
  <div class="candidate-info">${app.name} &nbsp;·&nbsp; ${app.email} &nbsp;·&nbsp; Applied: ${app.applied_at.substring(0, 10)}</div>

  <div class="score-card">
    <div class="label">AI Candidate Scoring Fit</div>
    <div class="score-badge">${app.score}% Match</div>
  </div>

  <div class="section">
    <h3>Evaluation Justification</h3>
    <div class="justification">${app.justification}</div>
  </div>

  <div class="skills-grid">
    <div class="skills-col">
      <h3 style="color:#10b981;">✅ Matched Skills</h3>
      <div>${matchedSkillsHtml}</div>
    </div>
    <div class="skills-col">
      <h3 style="color:#ef4444;">❌ Missing Skills</h3>
      <div>${missingSkillsHtml}</div>
    </div>
  </div>

  ${questionsHtml}

  <div class="status-box">
    <div>Application Status</div>
    <span class="status-chip status-${app.status.toLowerCase().replace(' ', '_')}">${app.status}</span>
  </div>

  <div class="footer">Generated by InternIQ — AI-Powered Recruitment Portal &nbsp;·&nbsp; Confidential Evaluation Document</div>
</body>
</html>`;

  // Create downloadable blob and trigger save
  const blob = new Blob([reportHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `InternIQ_Report_${app.name.replace(/\s+/g, '_')}_${app.applied_at.substring(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Evaluation report downloaded!', 'success');
}

// ─────────────────────────────────────────────
// LOCAL STORAGE REPORT MANAGEMENT
// ─────────────────────────────────────────────
const SAVED_REPORTS_KEY = 'interniq_saved_reports';

function saveReportToLocal(appId) {
  const app = state.applications.find(a => a.id === appId);
  if (!app) { showToast('Application not found.', 'error'); return; }

  const internship = state.internships.find(i => i.id === app.internship_id) || { title: 'Unknown', company: 'Unknown' };

  const savedReports = JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY) || '[]');

  // Check if already saved
  const alreadySaved = savedReports.find(r => r.id === appId);
  if (alreadySaved) {
    showToast('Report already saved to local storage!', 'info');
    return;
  }

  const reportEntry = {
    id: appId,
    savedAt: new Date().toISOString(),
    candidateName: app.name,
    candidateEmail: app.email,
    internshipTitle: internship.title,
    company: internship.company,
    score: app.score,
    status: app.status,
    justification: app.justification,
    matchedSkills: app.matched_skills,
    missingSkills: app.missing_skills,
    interviewQuestions: app.interview_questions || [],
    appliedAt: app.applied_at
  };

  savedReports.push(reportEntry);
  localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(savedReports));
  showToast(`Report for ${app.name} saved to local storage! ✅`, 'success');

  // Refresh saved reports list if it's currently visible
  if (document.getElementById('view-emp-saved') && document.getElementById('view-emp-saved').classList.contains('active')) {
    renderSavedReports();
  }
}

function renderSavedReports() {
  const container = document.getElementById('saved-reports-container');
  if (!container) return;

  const savedReports = JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY) || '[]');

  if (savedReports.length === 0) {
    container.innerHTML = `
      <div class="glass-card" style="text-align:center; padding: 4rem; color: var(--text-2);">
        🗂️ No saved reports yet. Open a candidate evaluation report and click <strong>Save to Local</strong>.
      </div>
    `;
    return;
  }

  container.innerHTML = savedReports.map(r => {
    const scoreClass = r.score >= 70 ? 'strong' : r.score >= 50 ? 'moderate' : 'weak';
    const savedDate = new Date(r.savedAt).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
    return `
      <div class="app-card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:1rem; font-weight:700; color:white; margin-bottom:2px;">${r.candidateName}</div>
          <div style="font-size:0.8rem; color:var(--text-2);">${r.internshipTitle} · ${r.company}</div>
          <div style="font-size:0.75rem; color:var(--text-3); margin-top:4px;">Saved: ${savedDate}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="score-badge ${scoreClass}">${r.score}%</span>
          <span class="app-status-badge ${r.status.toLowerCase().replace(' ', '_')}">${r.status}</span>
          <button class="btn-ghost" style="padding:5px 10px; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;" onclick="viewSavedReport('${r.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            View
          </button>
          <button class="btn-ghost" style="padding:5px 10px; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;" onclick="downloadSavedReport('${r.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
          <button class="btn-ghost" style="padding:5px 10px; font-size:0.75rem; color:var(--red); border-color:rgba(239,68,68,0.3);" onclick="deleteSavedReport('${r.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function viewSavedReport(id) {
  const savedReports = JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY) || '[]');
  const r = savedReports.find(rep => rep.id === id);
  if (!r) { showToast('Report not found.', 'error'); return; }

  // Inject into applications state temporarily and open modal
  const tempApp = {
    id: r.id,
    name: r.candidateName,
    email: r.candidateEmail,
    internship_id: null,
    score: r.score,
    status: r.status,
    justification: r.justification,
    matched_skills: r.matchedSkills,
    missing_skills: r.missingSkills,
    interview_questions: r.interviewQuestions,
    applied_at: r.appliedAt
  };
  const orig = state.applications.find(a => a.id === id);
  if (!orig) state.applications.push(tempApp); // add temporarily if not in list
  openEvalReport(id);
}

function downloadSavedReport(id) {
  const savedReports = JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY) || '[]');
  const r = savedReports.find(rep => rep.id === id);
  if (!r) { showToast('Report not found.', 'error'); return; }

  const scoreBadgeColor = r.score >= 70 ? '#10b981' : r.score >= 50 ? '#f59e0b' : '#ef4444';
  const questionsHtml = r.interviewQuestions && r.interviewQuestions.length > 0
    ? `<h3 style="color:#818cf8; font-size:14px; margin:24px 0 8px;">STAR Interview Questions</h3>
       <ol style="margin:0;padding-left:18px;color:#94a3b8;font-size:13px;line-height:1.7;">
         ${r.interviewQuestions.map(q => `<li>${q}</li>`).join('')}
       </ol>`
    : '';

  const reportHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<title>InternIQ Evaluation Report — ${r.candidateName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Outfit',sans-serif; background:#f8fafc; color:#1e293b; padding:48px; }
  .header { display:flex; justify-content:space-between; padding-bottom:24px; border-bottom:2px solid #e2e8f0; margin-bottom:24px; }
  .logo { font-size:24px; font-weight:800; color:#6366f1; }
  .logo span { color:#22c55e; }
  h1 { font-size:20px; font-weight:700; color:#0f172a; margin-bottom:4px; }
  .meta { font-size:12px; color:#64748b; text-align:right; line-height:1.7; }
  .score-card { display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; border-radius:10px; padding:16px 20px; border-left:4px solid ${scoreBadgeColor}; margin-bottom:20px; }
  .score-val { font-size:22px; font-weight:800; color:${scoreBadgeColor}; }
  .justification { font-size:13px; color:#475569; line-height:1.6; background:#f8fafc; border-radius:8px; padding:14px; border:1px solid #e2e8f0; margin-top:8px; }
  .section h3 { font-size:13px; font-weight:700; color:#6366f1; margin:20px 0 8px; text-transform:uppercase; }
  .chip { display:inline-block; border-radius:4px; padding:2px 8px; font-size:11px; margin:2px; }
  .matched { background:#0d2a1f; border:1px solid #10b981; color:#10b981; }
  .missing { background:#2a0d0d; border:1px solid #ef4444; color:#ef4444; }
  .footer { margin-top:32px; font-size:11px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0; padding-top:16px; }
</style>
</head><body>
  <div class="header">
    <div><div class="logo">Intern<span>IQ</span></div><div style="font-size:12px;color:#64748b;margin-top:2px;">AI-Powered Internship Portal</div></div>
    <div class="meta">
      <div><strong>Report Generated:</strong> ${new Date(r.savedAt).toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short' })}</div>
      <div><strong>Role:</strong> ${r.internshipTitle}</div>
      <div><strong>Company:</strong> ${r.company}</div>
    </div>
  </div>
  <h1>AI Candidate Evaluation Report</h1>
  <div style="font-size:13px;color:#475569;margin-bottom:24px;">${r.candidateName} · ${r.candidateEmail} · Applied: ${r.appliedAt.substring(0,10)}</div>
  <div class="score-card"><div style="font-size:14px;font-weight:700;">AI Candidate Scoring Fit</div><div class="score-val">${r.score}% Match</div></div>
  <div class="section"><h3>Evaluation Justification</h3><div class="justification">${r.justification}</div></div>
  <div class="section">
    <h3>Matched Skills</h3>
    ${r.matchedSkills.length > 0 ? r.matchedSkills.map(s => `<span class="chip matched">${s}</span>`).join('') : '<span style="color:#64748b;font-size:12px;">None identified</span>'}
  </div>
  <div class="section">
    <h3>Missing Skills</h3>
    ${r.missingSkills.length > 0 ? r.missingSkills.map(s => `<span class="chip missing">${s}</span>`).join('') : '<span style="color:#64748b;font-size:12px;">None</span>'}
  </div>
  ${questionsHtml}
  <div class="footer">Generated by InternIQ · Confidential Evaluation Document</div>
</body></html>`;

  const blob = new Blob([reportHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `InternIQ_Report_${r.candidateName.replace(/\s+/g, '_')}_${r.appliedAt.substring(0,10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Report downloaded!', 'success');
}

function deleteSavedReport(id) {
  let savedReports = JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY) || '[]');
  savedReports = savedReports.filter(r => r.id !== id);
  localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(savedReports));
  showToast('Report removed from local storage.', 'info');
  renderSavedReports();
}

function updateApplicantStatus(appId, newStatus) {
  fetch('/api/update_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ application_id: appId, status: newStatus })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      const app = state.applications.find(a => a.id === appId);
      if (app) app.status = newStatus;
      
      showToast(`Candidate status updated to ${newStatus}!`, 'success');
      loadEmployerRoleApplicants();
      renderStudentApplications();
    } else {
      showToast(data.message || 'Failed to update status.', 'error');
    }
  })
  .catch(err => {
    console.error(err);
    showToast('Failed to connect to server.', 'error');
  });
}

function updateApplicantStatusFromModal(appId, newStatus) {
  updateApplicantStatus(appId, newStatus);
  closeEvalModalDirect();
}

// ─────────────────────────────────────────────
// EMPLOYER MODULE: POST NEW INTERNSHIP
// ─────────────────────────────────────────────
function submitNewInternship() {
  const title = document.getElementById('post-title').value.trim();
  const company = document.getElementById('post-company').value.trim();
  const category = document.getElementById('post-category').value;
  const location = document.getElementById('post-location').value.trim();
  const duration = document.getElementById('post-duration').value.trim();
  const stipend = document.getElementById('post-stipend').value.trim();
  const skillsText = document.getElementById('post-skills').value.trim();
  const description = document.getElementById('post-desc').value.trim();
  const eligibility = document.getElementById('post-eligibility').value.trim();

  if (!title || !company || !location || !duration || !stipend || !description) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  const skills = skillsText ? skillsText.split(',').map(s => s.trim()).filter(Boolean) : [];

  const payload = {
    title, company, category, location, duration, stipend, skills, description, eligibility
  };

  fetch('/api/internships', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(res => {
    if (res.status === 'success') {
      showToast('Internship posting published successfully!', 'success');
      
      // Clear fields
      document.getElementById('post-title').value = '';
      document.getElementById('post-company').value = '';
      document.getElementById('post-location').value = '';
      document.getElementById('post-duration').value = '';
      document.getElementById('post-stipend').value = '';
      document.getElementById('post-skills').value = '';
      document.getElementById('post-desc').value = '';
      document.getElementById('post-eligibility').value = '';

      fetchInitialData(); // Sync listings
      switchEmployerView('roles'); // Switch back to role postings
    } else {
      showToast(res.message || 'Publishing failed.', 'error');
    }
  })
  .catch(err => {
    console.error("Publish error:", err);
    showToast('Network error during publishing.', 'error');
  });
}

// ─────────────────────────────────────────────
// PLATFORM SETTINGS & KEY MODULE
// ─────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettingsModal(e) {
  if (e.target.className === 'modal-overlay') {
    closeSettingsModalDirect();
  }
}
function closeSettingsModalDirect() {
  document.getElementById('settings-modal').style.display = 'none';
}

function toggleKeyVisibility() {
  const input = document.getElementById('api-key-input');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  state.apiKey = key;
  localStorage.setItem('interniq_api_key', key);
  
  syncKeyWithBackend(key);
}

function syncKeyWithBackend(key) {
  fetch('/api/save_key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key })
  })
  .then(r => r.json())
  .then(res => {
    if (res.status === 'success') {
      showToast('API Key saved and sync complete!', 'success');
      updateApiKeyIndicator(!!key);
      closeSettingsModalDirect();
    }
  })
  .catch(() => {
    showToast('Key saved locally in browser cache', 'success');
    updateApiKeyIndicator(!!key);
  });
}

function updateApiKeyIndicator(isConnected) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (!dot || !label) return;

  if (isConnected) {
    dot.className = 'status-dot online';
    label.textContent = 'GenAI connected';
  } else {
    dot.className = 'status-dot offline';
    label.textContent = 'GenAI disconnected';
  }
}

// ─────────────────────────────────────────────
// GLOBAL TOAST
// ─────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ─────────────────────────────────────────────
// ADVANCED: AI CAREER COACH CHATBOT CONTROLLER
// ─────────────────────────────────────────────
function toggleChatCoach() {
  const drawer = document.getElementById('chat-drawer');
  if (drawer) {
    drawer.classList.toggle('open');
  }
}

function handleChatKeydown(e) {
  if (e.key === 'Enter') {
    sendChatMessage();
  }
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const box = document.getElementById('chat-messages-box');
  const sendBtn = document.getElementById('chat-send-btn');
  
  if (!input || !box || !sendBtn) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  // Render user message
  const userMsgDiv = document.createElement('div');
  userMsgDiv.className = 'chat-message user';
  userMsgDiv.textContent = text;
  box.appendChild(userMsgDiv);
  
  input.value = '';
  box.scrollTop = box.scrollHeight;
  
  // Disable input & button during processing
  input.disabled = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '...';
  
  // Gather contextual details
  let lastAppScore = null;
  let targetSkills = [];
  
  if (state.applications.length > 0) {
    // Find the latest scored application
    const scoredApp = [...state.applications].reverse().find(a => a.score !== null);
    if (scoredApp) {
      lastAppScore = scoredApp.score;
      const targetRole = state.internships.find(i => i.id === scoredApp.internship_id);
      if (targetRole) {
        targetSkills = targetRole.skills;
      }
    }
  }
  
  // Get chat history from current dialog UI
  const history = [];
  const msgEls = box.querySelectorAll('.chat-message');
  msgEls.forEach(el => {
    // Skip the very last user message (which we add as parameters next)
    if (el === userMsgDiv) return;
    
    history.push({
      role: el.classList.contains('user') ? 'user' : 'model',
      text: el.textContent.trim()
    });
  });
  
  const payload = {
    message: text,
    history: history.slice(-6), // Keep history compact
    context: {
      role: state.mode, // 'student' or 'employer'
      last_app_score: lastAppScore,
      target_skills: targetSkills
    }
  };
  
  // Renders a loading bot card
  const botLoadingDiv = document.createElement('div');
  botLoadingDiv.className = 'chat-message bot';
  botLoadingDiv.innerHTML = '<span class="spinner" style="width:12px;height:12px;"></span> Thinking...';
  box.appendChild(botLoadingDiv);
  box.scrollTop = box.scrollHeight;
  
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(res => {
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    
    // Remove loading card
    box.removeChild(botLoadingDiv);
    
    // Render real response
    const botMsgDiv = document.createElement('div');
    botMsgDiv.className = 'chat-message bot';
    botMsgDiv.textContent = res.reply || 'Sorry, I couldn\'t formulate a reply.';
    box.appendChild(botMsgDiv);
    box.scrollTop = box.scrollHeight;
    input.focus();
  })
  .catch(err => {
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    box.removeChild(botLoadingDiv);
    
    const botMsgDiv = document.createElement('div');
    botMsgDiv.className = 'chat-message bot';
    botMsgDiv.textContent = 'Error connecting to the career coach backend server. Please verify your connection.';
    box.appendChild(botMsgDiv);
    box.scrollTop = box.scrollHeight;
  });
}

// ─────────────────────────────────────────────
// ADVANCED: PORTAL LOGIN MODULE
// ─────────────────────────────────────────────
state.loginRole = 'student';

function setLoginRole(role) {
  state.loginRole = role;
  
  // Update tabs active state
  document.querySelectorAll('.login-role-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`login-role-${role}`).classList.add('active');
  
  // Update placeholders and helper
  const emailInput = document.getElementById('login-email');
  const demoText = document.getElementById('demo-role-text');
  
  if (role === 'student') {
    emailInput.placeholder = 'student@interniq.com';
    demoText.textContent = 'Student';
  } else {
    emailInput.placeholder = 'employer@interniq.com';
    demoText.textContent = 'Employer';
  }
  
  // Clear fields
  emailInput.value = '';
  document.getElementById('login-password').value = '';
}

function togglePasswordVisibility() {
  const pwdInput = document.getElementById('login-password');
  const icon = document.getElementById('eye-icon');
  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    pwdInput.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

function useDemoCredentials() {
  const email = document.getElementById('login-email');
  const password = document.getElementById('login-password');
  
  if (state.loginRole === 'student') {
    email.value = 'student@interniq.com';
    password.value = 'student123';
  } else {
    email.value = 'employer@interniq.com';
    password.value = 'employer123';
  }
  showToast(`${state.loginRole === 'student' ? 'Student' : 'Employer'} Demo credentials loaded!`, 'success');
}

function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');

  if (!email || !password) {
    showToast('Please fill in all fields.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div><span style="margin-left:8px">Signing in...</span>';

  setTimeout(() => {
    let success = false;
    if (state.loginRole === 'student' && email === 'student@interniq.com' && password === 'student123') {
      success = true;
    } else if (state.loginRole === 'employer' && email === 'employer@interniq.com' && password === 'employer123') {
      success = true;
    }

    if (success) {
      localStorage.setItem('interniq_logged_in', 'true');
      localStorage.setItem('interniq_user_role', state.loginRole);
      
      showToast(`Welcome back to InternIQ!`, 'success');
      
      document.getElementById('login-wrapper').style.display = 'none';
      document.getElementById('app-layout-wrapper').style.display = 'flex';
      
      // Auto toggle to correct portal view
      togglePortalMode(state.loginRole);
      
      btn.disabled = false;
      btn.innerHTML = '<span>Sign In</span>';
    } else {
      showToast('Invalid email or password.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span>Sign In</span>';
    }
  }, 1000);
}

function handleLogout() {
  localStorage.removeItem('interniq_logged_in');
  localStorage.removeItem('interniq_user_role');
  
  showToast('Logged out successfully', 'success');
  
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  
  // Close chat coach
  const drawer = document.getElementById('chat-drawer');
  if (drawer) drawer.classList.remove('open');

  checkLoginState();
}

function checkLoginState() {
  const loggedIn = localStorage.getItem('interniq_logged_in') === 'true';
  const role = localStorage.getItem('interniq_user_role') || 'student';
  
  const loginWrapper = document.getElementById('login-wrapper');
  const appWrapper = document.getElementById('app-layout-wrapper');
  const toggleContainer = document.getElementById('mode-toggle-container');
  
  if (loggedIn) {
    if (loginWrapper) loginWrapper.style.display = 'none';
    if (appWrapper) appWrapper.style.display = 'flex';
    
    // Lock workspace mode toggle to prevent switching
    if (toggleContainer) {
      toggleContainer.innerHTML = `
        <div style="padding: 6px 18px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; color: white; background: var(--grad-brand); box-shadow: 0 4px 10px rgba(99, 102, 241, 0.2);">
          ${role === 'student' ? '👨‍🎓 Student Workspace' : '💼 Employer Workspace'}
        </div>
      `;
    }
    
    togglePortalMode(role);
  } else {
    if (loginWrapper) loginWrapper.style.display = 'flex';
    if (appWrapper) appWrapper.style.display = 'none';
    
    // Restore default toggles
    if (toggleContainer) {
      toggleContainer.innerHTML = `
        <button class="mode-btn active" id="mode-btn-student" onclick="togglePortalMode('student')">👨‍🎓 Student Mode</button>
        <button class="mode-btn" id="mode-btn-employer" onclick="togglePortalMode('employer')">💼 Employer Mode</button>
      `;
    }
    
    setLoginRole('student'); // Reset to student login view
  }
}

// ─────────────────────────────────────────────
// ADVANCED: QUESTION BANK PREP MODULE
// ─────────────────────────────────────────────
state.selectedPrepCategory = 'Frontend Development';

const questionBank = {
  'Frontend Development': [
    { q: "What is the difference between state and props in React?", a: "Props are read-only inputs passed into a component from its parent, while state is local and private data managed internally by the component that can change over time." },
    { q: "Explain the Virtual DOM and how React uses it.", a: "React creates a lightweight in-memory copy of the real DOM. When state changes, React updates the Virtual DOM first, compares it with the previous snapshot (diffing), and updates only the changed elements in the real DOM (reconciliation)." },
    { q: "What are React Hooks, and what rules must they follow?", a: "Hooks let you use state and lifecycle methods in functional components. Rules: 1. Only call hooks at the top level (not inside loops or conditions). 2. Only call hooks from React function components or custom Hooks." },
    { q: "What are Redux reducers and what constraints must they satisfy?", a: "Reducers are pure functions that take the current state and an action, and return a new state. They must be pure (no side effects, no API calls, no mutating inputs) and deterministic." },
    { q: "Explain Event Delegation and why it is useful in DOM manipulation.", a: "Event delegation is a technique where a single event listener is attached to a parent element to handle events bubbles up from child elements, reducing memory usage and simplifying dynamic item handling." },
    { q: "Contrast CSS Flexbox and Grid layouts.", a: "Flexbox is one-dimensional (deals with columns OR rows at a time, ideal for linear components like menus), while Grid is two-dimensional (manages rows AND columns simultaneously, perfect for full page templates)." },
    { q: "What is Web Accessibility (ARIA) and how do you implement it?", a: "Accessible Rich Internet Applications (ARIA) is a set of roles and attributes that make web content accessible to assistive technologies (like screen readers) for interactive widgets lacking native HTML tags." },
    { q: "What is the difference between Promises and Async/Await in Javascript?", a: "Promises are ES6 objects used for async handling using .then() callbacks. Async/Await is ES8 syntax acting as syntactic sugar over promises, allowing asynchronous code to be written sequentially like synchronous code." },
    { q: "What do Module Bundlers like Webpack or Vite accomplish?", a: "Bundlers process your application codebase (JavaScript, CSS, assets), resolve dependency imports, compile modern features to browser-friendly targets, and generate optimized assets for production." },
    { q: "Contrast Server-Side Rendering (SSR) and Client-Side Rendering (CSR).", a: "SSR generates complete HTML on the server for each request, ensuring fast initial page load and superior SEO. CSR downloads a minimal HTML stub and builds out DOM elements dynamically on the client." }
  ],
  'Backend Development': [
    { q: "What is REST and what are its key constraints?", a: "REST (Representational State Transfer) is an architectural style for APIs. Constraints include statelessness, client-server separation, cacheability, and a uniform interface." },
    { q: "How do you optimize SQL database queries?", a: "Use indexes on frequently searched columns, write specific SELECT statements instead of SELECT *, analyze execution plans (EXPLAIN), and avoid nested subqueries when JOINs are more efficient." },
    { q: "What is connection pooling and why is it useful?", a: "Instead of creating a new database connection for every request (which is resource-expensive), connection pooling maintains a cache of active connections that can be reused." },
    { q: "Describe the Model-View-Controller (MVC) architecture.", a: "MVC is a design pattern separating concerns: Model manages database logic, View renders UI screens, and Controller routes inputs between the Model and View." },
    { q: "How does JWT-based authentication work?", a: "After login, the server signs a JSON Web Token containing user metadata and returns it to the client. The client attaches this token in authorization headers for subsequent requests. The server validates the signature without querying the database." },
    { q: "Contrast Microservices and Monolithic architectures.", a: "Monolith compiles all codebases into a single runtime package, which is simple to deploy but hard to scale. Microservices split business logic into isolated, independent services communicating via APIs, enhancing fault isolation." },
    { q: "What is the difference between Horizontal and Vertical scaling?", a: "Vertical scaling increases the CPU/RAM capacity of a single server. Horizontal scaling adds more machines to your server cluster, requiring load balancers to distribute traffic." },
    { q: "What is Database Normalization and why do we do it?", a: "The process of organizing data tables to reduce redundancy, eliminate data anomalies, and enforce referential integrity using standard forms (1NF, 2NF, 3NF)." },
    { q: "What is Caching and how is Redis utilized in backend applications?", a: "Caching stores frequently accessed query inputs in memory. Redis is an in-memory key-value database commonly used to cache session tokens, database results, or query counts to minimize response latency." },
    { q: "What is CORS and how do you resolve its issues?", a: "Cross-Origin Resource Sharing (CORS) is a browser security mechanism blocking scripts from requesting resources on different domains. Resolved by configuring Access-Control-Allow-Origin headers on the target server." }
  ],
  'Data Science / ML': [
    { q: "What is overfitting and how do you prevent it?", a: "Overfitting happens when a model learns noise in training data. Prevent it using cross-validation, regularization (L1/L2), pruning decision trees, dropout layers, or gathering more training data." },
    { q: "Explain the difference between L1 (Lasso) and L2 (Ridge) regularization.", a: "L1 adds the absolute value of coefficients as a penalty and can shrink coefficients to exactly zero (performing feature selection). L2 adds the squared value of coefficients and shrinks them close to zero but not exactly zero." },
    { q: "What is the difference between supervised and unsupervised learning?", a: "Supervised learning uses labeled training data (inputs mapped to outputs), while unsupervised learning discovers hidden patterns or groupings in unlabeled data (e.g. clustering)." },
    { q: "Describe the Bias-Variance tradeoff in Machine Learning.", a: "Bias represents error due to simplistic assumptions (underfitting). Variance represents sensitivity to training data noise (overfitting). High bias leads to low complexity, while high variance leads to high complexity. Goal is minimizing both." },
    { q: "What is the difference between Precision and Recall?", a: "Precision measures of all predicted positive items, how many were actually positive. Recall measures of all actual positive items, how many were correctly predicted by the model." },
    { q: "Compare Random Forest and Gradient Boosting algorithms.", a: "Random Forest is a bagging technique training independent trees in parallel and averaging results. Gradient Boosting is a boosting technique training sequential trees, where each tree corrects errors of previous models." },
    { q: "How does Gradient Descent optimization work?", a: "An optimization algorithm that iteratively adjusts model parameters in the direction of steepest descent (negative gradient) of the loss function to locate global/local minima." },
    { q: "What is PCA and when is it applied?", a: "Principal Component Analysis (PCA) is an unsupervised dimensionality reduction method that projects high-dimensional data onto orthogonal directions of maximum variance to simplify feature datasets." },
    { q: "What do Activation Functions accomplish in neural networks?", a: "Activation functions (e.g. ReLU, Sigmoid) introduce non-linear mapping capabilities to network layers, allowing neural networks to model complex non-linear relationships." },
    { q: "What is a Confusion Matrix and what metrics are derived from it?", a: "A tabular summary comparing actual versus predicted classifications. Used to compute accuracy, precision, recall, F1-score, and false-positive rates." }
  ],
  'UI/UX Design': [
    { q: "What is a Design System and why is it important?", a: "A collection of reusable components, tokens, and standards (colors, typography, spacing) that ensures visual consistency and speeds up development across a product." },
    { q: "Explain the difference between wireframes, mockups, and prototypes.", a: "Wireframes are low-fidelity structural layouts. Mockups are high-fidelity static visual designs. Prototypes are interactive mockups that simulate user journeys." },
    { q: "What is heuristic evaluation in UX design?", a: "A usability inspection method where designs are evaluated against recognized usability principles (heuristics), such as user control, consistency, and error prevention." },
    { q: "What is WCAG and why is it relevant for designers?", a: "Web Content Accessibility Guidelines (WCAG) define global technical standards for digital accessibility, advising on contrast ratios, readable font scales, and screen reader structures." },
    { q: "What is a User Persona and how is it constructed?", a: "A semi-fictional archetype representing a product's target user base, formulated from demographic data, behavioral patterns, pain points, and specific goals gathered from real user research." },
    { q: "Describe Information Architecture (IA) in digital design.", a: "IA is the structural layout and categorization of digital content, ensuring menus, labels, and pages are organized logically so users can locate details intuitively." },
    { q: "What is Usability Testing and how is it executed?", a: "A testing methodology where representative users complete specific tasks using a prototype or product while designers observe points of friction, confusion, or success." },
    { q: "What are Gestalt Principles and how do they apply to UI layouts?", a: "Gestalt principles (Proximity, Similarity, Continuity, Closure) explain how human vision groups visual elements. Designers use them to arrange layouts so users perceive structural associations." },
    { q: "Describe the Mobile-First design philosophy.", a: "A strategy where layouts are designed for the smallest mobile screens first, forcing prioritization of core features and content, and progressively enhanced for larger desktop viewports." },
    { q: "What is A/B Testing and how is it applied in UX design?", a: "A comparative testing method where two versions of a design screen (A and B) are shown to different user cohorts to determine which layout yields superior conversion or retention metrics." }
  ],
  'Product Management': [
    { q: "How do you prioritize features for a product roadmap?", a: "Use prioritization frameworks like RICE (Reach, Impact, Confidence, Effort) or MoSCoW (Must-have, Should-have, Could-have, Won't-have) to balance customer value against development costs." },
    { q: "What is an MVP and how do you define its scope?", a: "A Minimum Viable Product has just enough features to satisfy early adopters and gather feedback for iterative development. Scope is defined by identifying the core user problem and building the simplest solution." },
    { q: "How would you handle a feature release that shows negative engagement metrics?", a: "Roll back or toggle off the feature if critical, review user feedback sessions/telemetry, identify friction points, and iterate on designs or user guidance before re-releasing." },
    { q: "What are the key startup metrics (AARRR)?", a: "The Pirate Metrics framework tracks: Acquisition (how users find you), Activation (first great experience), Retention (keep coming back), Referral (invite others), and Revenue (monetization)." },
    { q: "Contrast CAC and LTV.", a: "Customer Acquisition Cost (CAC) is the total marketing spend divided by new users. Lifetime Value (LTV) is the projected revenue a user generates over their lifecycle. Ideal LTV:CAC ratio is 3:1." },
    { q: "What are the core components of a Product Requirement Document (PRD)?", a: "PRDs define: Product Goals, User Personas, Feature Scope, User Flow Diagrams, Technical Constraints, Release Milestones, and Success KPIs." },
    { q: "Describe User Journey Mapping.", a: "A visual timeline mapping the steps a customer takes to achieve a goal with your product, documenting actions, feelings, and friction points along the route." },
    { q: "What is Net Promoter Score (NPS) and how is it computed?", a: "A customer loyalty metric calculated by asking users: 'How likely are you to recommend us?' Respondents score 0-10. % Promoters (9-10) minus % Detractors (0-6) equals NPS." },
    { q: "Contrast Agile Velocity and Capacity.", a: "Velocity is the average amount of story points a team completes in a sprint. Capacity is the estimated available effort a team has for an upcoming sprint, accounting for vacations and meetings." },
    { q: "Describe the Product Lifecycle (PLC) stages.", a: "The stages a product passes through: Introduction (launch and feedback), Growth (scaling and marketing), Maturity (peak adoption and optimization), and Decline (market shift or sunsetting)." }
  ]
};

function renderPrepPortal() {
  const catsContainer = document.getElementById('prep-categories-list');
  if (!catsContainer) return;

  const categories = Object.keys(questionBank);

  // Load category sidebar buttons
  catsContainer.innerHTML = categories.map(cat => `
    <button class="prep-category-btn ${state.selectedPrepCategory === cat ? 'active' : ''}" onclick="selectPrepCategory('${cat}')">
      ${cat === 'Frontend Development' ? '🎨 ' : cat === 'Backend Development' ? '⚙️ ' : cat === 'Data Science / ML' ? '🧠 ' : cat === 'UI/UX Design' ? '📐 ' : '📈 '} ${cat}
    </button>
  `).join('');

  // Load selected category or searched questions
  const qContainer = document.getElementById('prep-questions-list');
  const title = document.getElementById('prep-category-title');
  const searchInput = document.getElementById('prep-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (!qContainer || !title) return;

  let list = [];
  if (query) {
    title.textContent = `Search Results for "${query}"`;
    // Scan all categories
    for (const [cat, questions] of Object.entries(questionBank)) {
      questions.forEach(q => {
        if (q.q.toLowerCase().includes(query) || q.a.toLowerCase().includes(query)) {
          list.push({ ...q, category: cat });
        }
      });
    }
  } else {
    title.textContent = `${state.selectedPrepCategory} Practice Questions`;
    list = questionBank[state.selectedPrepCategory] || [];
  }

  if (list.length === 0) {
    qContainer.innerHTML = '<div style="color:var(--text-3); text-align:center; padding: 2rem;">🔍 No matching questions found.</div>';
    return;
  }

  qContainer.innerHTML = list.map((item, idx) => `
    <div class="prep-question-item">
      <div style="display:flex; justify-content:space-between; align-items:center; gap: 10px; flex-wrap: wrap;">
        <div class="prep-question-text">Q${idx+1}: ${item.q}</div>
        ${item.category ? `<span class="skill-chip" style="background:rgba(99,102,241,0.1); border-color:rgba(99,102,241,0.25); color:#818cf8; font-size:0.7rem;">${item.category}</span>` : ''}
      </div>
      <div class="prep-answer-text"><strong>Suggested Answer Guideline:</strong> ${item.a}</div>
      <div>
        <button class="btn-ghost" style="padding:4px 10px; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;" onclick="startMockPrep('${item.q.replace(/'/g, "\\'")}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Practice with Coach
        </button>
      </div>
    </div>
  `).join('');
}

function selectPrepCategory(category) {
  // Clear search bar input when toggling category
  const searchInput = document.getElementById('prep-search-input');
  if (searchInput) searchInput.value = '';
  
  state.selectedPrepCategory = category;
  renderPrepPortal();
}

function filterPrepQuestions() {
  renderPrepPortal();
}

function startMockPrep(question) {
  const drawer = document.getElementById('chat-drawer');
  const input = document.getElementById('chat-input');
  
  if (!drawer || !input) return;
  
  // Open chat coach
  if (!drawer.classList.contains('open')) {
    drawer.classList.add('open');
  }
  
  // Set instruction
  input.value = `Ask me the interview question: "${question}" and evaluate my answer using feedback.`;
  showToast('Prep question loaded into AI Career Coach!', 'success');
  input.focus();
}
