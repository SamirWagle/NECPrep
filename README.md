<div align="center">

<img src="frontend/public/favicon.ico" alt="NECPrep Logo" width="80" height="80" />

# NECPrep

**The open-source exam preparation platform for Nepal Engineering Council (NEC) license candidates.**

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/SamirWagle/EngineeringLisenseProject/pulls)
[![Open Source](https://badges.frapsoft.com/os/v1/open-source.svg?v=103)](https://github.com/ellerbrock/open-source-badges/)

[🌐 Live Demo](https://lisensepreparation.samirwagle.com.np/) · [🐛 Report a Bug](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new) · [✨ Request a Feature](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new) · [🤝 Contribute](#-contributing)

</div>

---

## Table of Contents

- [About the Project](#-about-the-project)
- [Screenshots](#-screenshots)
- [Features](#-features)
- [Topics Covered](#-topics-covered)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running Locally](#running-locally)
  - [Building for Production](#building-for-production)
- [Question Data](#-question-data)
- [Contributing](#-contributing)
- [Roadmap](#-roadmap)
- [Acknowledgements](#-acknowledgements)
- [License](#-license)

---

## About the Project

**NECPrep** is a free, open-source study platform designed specifically for engineers preparing for the **Nepal Engineering Council (NEC) license examination**. It brings together a rich question bank, smart practice modes, timed mock tests, and progress analytics — all in a clean, fast, fully client-side web app that works without any backend sign-up.

> No account required. Open the app, enter your name, and start studying immediately.

🌐 **Try it now:** [lisensepreparation.samirwagle.com.np](https://lisensepreparation.samirwagle.com.np/)

---

## Screenshots

<div align="center">

| Landing Page | Dashboard | Practice Hub |
|:---:|:---:|:---:|
| ![Landing](Screenshots/Screenshot%202026-03-05%20212111.png) | ![Dashboard](Screenshots/Screenshot%202026-03-05%20212124.png) | ![Practice](Screenshots/Screenshot%202026-03-05%20212137.png) |

</div>

---

## Features

| Feature | Description |
|---|---|
| **Dashboard** | Personalized overview showing accuracy, questions attempted, topics started, and recent quiz history |
| **Practice Hub** | Multiple practice modes — topic-based, chapter-based, quick random, and fully custom |
| **Topic Practice** | Drill per-subject question banks across all 10 NEC exam topics |
| **Chapter Practice** | Practice directly from textbook chapters (Books Ch 1–10) |
| **Quick Practice** | Instant 10-question random quiz to warm up fast |
| **Custom Practice** | Build your own quiz by selecting topics and question count |
| **Mock Tests** | Full-length, timed exams that simulate the real NEC license test |
| **Study Hub** | Read and review topic summaries before attempting questions |
| **Flashcards** | Flip-card review mode drawn from the question bank for active recall |
| **Bookmarks** | Save any question to revisit later |
| **Progress Tracker** | Visual analytics: overall completion %, accuracy rate, per-chapter breakdown |
| **3D Landing Page** | Immersive animated Three.js background on the landing screen |
| **Fully Offline-Ready** | All question data is bundled as JSON; progress is saved in `localStorage` |

---

## Topics Covered

The question bank spans all major NEC license examination subjects:

| # | Topic | Questions |
|---|---|---|
| 1 | Artificial Intelligence & Neural Networks | 150 |
| 2 | Computer Organization & Embedded Systems | 120 |
| 3 | Basic Electrical & Electronics Engineering | 100 |
| 4 | Computer Network & Network Security | 130 |
| 5 | Data Structures, Algorithms, Database & OS | 180 |
| 6 | Digital Logic & Microprocessor | 110 |
| 7 | Programming Languages & Applications | 200 |
| 8 | Project Planning, Design & Implementation | 90 |
| 9 | Software Engineering & OOAD | 140 |
| 10 | Theory of Computation & Computer Graphics | 160 |
| **Total** | | **1,380+** |

Plus **10 textbook chapters** (Ch 1–10) served from `public/data/books/` with auto-generated TypeScript metadata via `scripts/sync-chapters.mjs`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [React 19](https://react.dev) |
| **Language** | [TypeScript 5.9](https://www.typescriptlang.org) |
| **Build Tool** | [Vite 7](https://vite.dev) |
| **Routing** | [React Router DOM v7](https://reactrouter.com) |
| **3D / WebGL** | [Three.js](https://threejs.org) · [@react-three/fiber](https://r3f.docs.pmnd.rs) · [@react-three/drei](https://drei.docs.pmnd.rs) |
| **Animations** | [Framer Motion](https://www.framer.com/motion/) |
| **Icons** | [Lucide React](https://lucide.dev) |
| **Auth (opt)** | [Firebase](https://firebase.google.com) |
| **Persistence** | Browser `localStorage` (no server required) |
| **Deployment** | [Vercel](https://vercel.com) |

---

## Project Structure

```
EngineeringLicenseProject/
├── frontend/                          # Main React application
│   ├── public/
│   │   └── data/
│   │       ├── *.json                 # Topic-wise question banks
│   │       ├── all_questions.json     # Aggregated question bank
│   │       ├── model-question.json    # Model exam questions
│   │       └── books/
│   │           └── ch1–ch10.json      # Textbook chapter questions
│   └── src/
│       ├── components/
│       │   └── ThreeBackground.tsx    # Animated 3D landing background
│       ├── context/
│       │   └── UserContext.tsx        # Global user state (name, preferences)
│       ├── data/
│       │   ├── topics.ts              # Topic & mock test definitions
│       │   └── bookChapters.generated.ts  # Auto-generated chapter metadata
│       ├── layout/
│       │   └── AppShell.tsx           # Persistent sidebar + outlet layout
│       ├── pages/
│       │   ├── Landing.tsx            # Public landing page
│       │   ├── auth/                  # Auth screens
│       │   └── app/                   # Protected app screens
│       │       ├── Dashboard.tsx
│       │       ├── PracticeHub.tsx
│       │       ├── TopicPractice.tsx
│       │       ├── ChapterPracticeSelector.tsx
│       │       ├── QuickPractice.tsx
│       │       ├── CustomPractice.tsx
│       │       ├── MockTests.tsx
│       │       ├── MockTestQuiz.tsx
│       │       ├── StudyHub.tsx
│       │       ├── Flashcards.tsx
│       │       ├── Bookmarks.tsx
│       │       ├── Progress.tsx
│       │       ├── BookPractice.tsx
│       │       └── Settings.tsx
│       ├── routes/
│       │   └── AppRoutes.tsx          # Centralized route definitions
│       └── services/
│           └── localData.ts           # Data loading & localStorage helpers
└── scripts/
    └── sync-chapters.mjs              # Generates bookChapters.generated.ts from JSON files
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) **v18+**
- [npm](https://npmjs.com) **v9+** (or `pnpm` / `yarn`)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/SamirWagle/EngineeringLisenseProject.git
cd EngineeringLisenseProject

# 2. Install frontend dependencies
cd frontend
npm install
```

### Running Locally

```bash
# From the frontend/ directory
npm run dev
```

This will:
1. Run `sync-chapters.mjs` to auto-generate `bookChapters.generated.ts` from any JSON files in `public/data/books/`
2. Start the Vite dev server at **http://localhost:5173**

### Building for Production

```bash
# From the frontend/ directory
npm run build
```

The production-ready static files will be output to `frontend/dist/`. Deploy the `dist/` folder to any static host (Vercel, Netlify, GitHub Pages, etc.).

To preview the production build locally:

```bash
npm run preview
```

---

## Question Data

All question data lives in `frontend/public/data/` as JSON files and is fetched at runtime — no backend needed.

**Question format** (each entry in a topic JSON):

```json
{
  "qsns": "What is the time complexity of binary search?",
  "opt1": "O(n)",
  "opt2": "O(log n)",
  "opt3": "O(n²)",
  "opt4": "O(1)",
  "correct_option": "opt2",
  "correct_option_index": 1
}
```

### Adding Book Chapters

Drop a new `chN.json` file (same format as above) into `frontend/public/data/books/` and run:

```bash
node scripts/sync-chapters.mjs
```

The script will automatically detect the subject, assign a color and icon, and update `bookChapters.generated.ts`. This also runs automatically on every `npm run dev` and `npm run build`.

### Adding Topic Questions

1. Add your JSON file to `frontend/public/data/` following the format above.
2. Register the topic in `frontend/src/data/topics.ts` with an `id`, `name`, `questionCount`, and `dataFile`.

---

## Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and grow. **Any contribution you make is greatly appreciated.**

### Ways to Contribute

- 🐛 **Bug Reports** — Found something broken? [Open an issue](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new).
- ✨ **Feature Requests** — Have an idea? [Start a discussion](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new).
- 📚 **Question Bank** — Add or improve questions in any topic JSON.
- 🌐 **Translations** — Help make the platform accessible in Nepali or other languages.
- 💅 **UI/UX Improvements** — Better layouts, accessibility, responsive design.
- 🧪 **Tests** — Add unit or integration tests.

### How to Contribute

1. **Fork** the repository
2. **Create** your feature branch
   ```bash
   git checkout -b feature/your-amazing-feature
   ```
3. **Commit** your changes using [Conventional Commits](https://www.conventionalcommits.org/)
   ```bash
   git commit -m "feat: add spaced repetition to flashcards"
   ```
4. **Push** to your branch
   ```bash
   git push origin feature/your-amazing-feature
   ```
5. **Open a Pull Request** — describe what you changed and why

Please make sure your PR:
- Follows the existing code style (TypeScript strict, ESLint rules pass)
- Doesn't break the existing build (`npm run build` succeeds)
- Includes relevant updates to data/types if adding new topics

---

## Roadmap

- [ ] Spaced repetition algorithm for Flashcards
- [ ] Dark / Light theme toggle
- [ ] Nepali language support (i18n)
- [ ] Detailed per-question explanation / solution notes
- [ ] PWA support for fully offline usage
- [ ] Share quiz results / leaderboard
- [ ] Firebase cloud sync for cross-device progress
- [ ] More model question sets and past exam papers

Have a feature idea not listed here? [Open a feature request!](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new)

---

## Acknowledgements

This project was built with the help of some amazing tools and people:

- **[Samir Wagle](https://github.com/SamirWagle)** — Creator & maintainer
- **[GitHub Copilot](https://github.com/features/copilot)** — AI pair programmer that helped accelerate development
- **[Claude (Anthropic)](https://www.anthropic.com)** — AI assistant that helped with code architecture and problem-solving
- **[React](https://react.dev)**, **[Vite](https://vite.dev)**, **[Three.js](https://threejs.org)**, **[Framer Motion](https://www.framer.com/motion/)** — The incredible open-source libraries powering this app
- Every **NEC license candidate** who uses this platform and gives feedback 🙏

---

## License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

<div align="center">

Made by [Samir Wagle](https://github.com/SamirWagle) for every engineer working toward their NEC license.

**If NECPrep helped you study, please consider giving it a ⭐ — it means a lot!**

[![GitHub stars](https://img.shields.io/github/stars/SamirWagle/EngineeringLisenseProject?style=social)](https://github.com/SamirWagle/EngineeringLisenseProject/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/SamirWagle/EngineeringLisenseProject?style=social)](https://github.com/SamirWagle/EngineeringLisenseProject/network/members)

</div>
