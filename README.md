# CodePilot

> AI-powered interactive onboarding for unfamiliar GitHub codebases.

CodePilot turns an unfamiliar GitHub repository into an interactive developer onboarding workspace.

Instead of manually searching through thousands of files, developers can map a repository and explore its architecture, important files, setup instructions, AI-powered answers, and guided onboarding missions.

## Live Demo

https://code-pilot-tawny.vercel.app/

## GitHub

https://github.com/drmungur/CodePilot

---

## The Problem

Joining an unfamiliar codebase can be difficult. Developers often need to figure out:

- Where the application starts
- How the architecture is organized
- Which files matter
- How requests flow through the system
- Where authentication and data layers live
- How to run the project
- What they should learn first

Traditional documentation can be incomplete or disconnected from the current codebase.

## The Solution

CodePilot analyzes a public GitHub repository and creates an interactive onboarding experience around it.

The workflow is:

```text
GitHub Repository
       |
       v
Repository Analysis
       |
       v
Codebase Intelligence
       |
       v
Interactive Workspace
       |
       v
AI Questions + Guided Missions
```

---

## Features

### Repository Mapping

Paste a public GitHub repository URL and CodePilot analyzes its structure, technologies, important files, and repository statistics.

### Overview

Get a high-level understanding of the repository without manually searching through the entire codebase.

### Architecture

Explore how the major parts of the repository are organized.

### Code Explorer

Identify important files and explore the repository through a focused set of relevant code.

### Setup Guide

Get repository-specific guidance for understanding how the project is configured and run.

### Ask Codebase

Ask questions about the repository and receive AI-generated answers based on the analyzed codebase.

### Onboarding Missions

CodePilot turns exploration into a guided learning workflow.

Example missions:

1. Find the entry point
2. Trace an API request end-to-end
3. Explore authentication
4. Explore the data layer

The goal is not only to explain a codebase, but to help developers actively learn it.

---

## How It Works

```text
GitHub Repository
       |
       v
Repository Analysis
       |
       v
Codebase Intelligence
       |
       +-------------------+
       |                   |
       v                   v
   Overview          Architecture
       |                   |
       +---------+---------+
                 |
                 v
          Code Explorer
                 |
                 v
           Ask Codebase
                 |
                 v
       Onboarding Missions
```

---

## Technology

### Frontend

- React
- Vite
- JavaScript
- CSS

### Backend

- Node.js
- Express
- GitHub API
- Repository analysis and classification

### AI

- Groq
- OpenAI-compatible chat completion API
- `openai/gpt-oss-20b`

### Deployment

- Vercel - frontend
- Render - backend
- GitHub - source repository

---

## IBM Bob 2.0

CodePilot was developed using IBM Bob 2.0 during the hackathon.

Bob was used throughout the development workflow for:

- Repository analysis and backend foundations
- Results workspace implementation
- AI provider integration
- UI and UX development
- Repository intelligence
- Interactive onboarding missions
- Testing and iteration

Development evidence is included in:

```text
bob_sessions/
```

The folder contains screenshots documenting Bob task-session work throughout the project.

---

## Architecture

```text
                 +---------------------+
                 |    CodePilot User   |
                 +----------+----------+
                            |
                            v
                 +---------------------+
                 |  Vercel Frontend    |
                 |    React + Vite     |
                 +----------+----------+
                            |
                            | HTTPS
                            v
                 +---------------------+
                 |   Render Backend    |
                 |    Node + Express   |
                 +--------+------+-----+
                          |      |
                    +-----+      +-----+
                    v                  v
              +-----------+      +-----------+
              |  GitHub   |      |   Groq    |
              |    API    |      |    AI     |
              +-----------+      +-----------+
```

---

## Running Locally

### Clone the repository

```bash
git clone https://github.com/drmungur/CodePilot.git
cd CodePilot
```

### Start the backend

```bash
cd backend
npm install
npm start
```

Create `backend/.env` using `backend/.env.example` and provide your own Groq API key.

Example:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
```

The backend runs on:

```text
http://localhost:3001
```

### Start the frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

---

## Project Structure

```text
CodePilot/
├── backend/
│   ├── lib/
│   │   ├── analyze.js
│   │   ├── classifier.js
│   │   └── github.js
│   ├── .env.example
│   ├── package.json
│   └── server.js
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── bob_sessions/
│   ├── task01_repo_analysis.png
│   ├── task02_results_views.png
│   ├── task03_ai_integration.png
│   ├── task04_ui_redesign.png
│   ├── task05_repository_intelligence.png
│   └── task06_interactive_missions.png
│
├── .gitignore
└── README.md
```

---

## Security

API keys are stored in environment variables and are not committed to the repository.

Do not commit `.env` files or API keys.

Only analyze public repositories when their contents are permitted to be accessed and used.

---

## Hackathon

Built for the IBM Bob 2.0 Hackathon.

CodePilot focuses on the developer onboarding workflow by helping developers move from an unfamiliar repository to a structured understanding of its architecture, code, setup, and development path.

---

## Links

**Live Demo:**
https://code-pilot-tawny.vercel.app/

**GitHub:**
https://github.com/drmungur/CodePilot
