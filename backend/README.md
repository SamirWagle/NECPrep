# License Exam Prep - Backend

Express.js + TypeScript backend with Supabase for the License Exam Preparation app.

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Copy the example env file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3001
FRONTEND_URL=http://localhost:5173
```

### 3. Set Up Supabase Database

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the SQL schema provided (see `docs/schema.sql` or ask for it)

### 4. Seed Questions

After setting up the database, seed your questions:

```bash
npm run seed
```

This reads from `datasets/extracted_questions/*.json` and populates the database.

### 5. Run the Server

Development mode with hot reload:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/topics` | Get all topics |
| GET | `/api/topics/:id` | Get single topic |
| GET | `/api/mock-tests` | Get all mock tests |
| GET | `/api/mock-tests/:id` | Get mock test details |

### Authenticated Endpoints

All authenticated endpoints require `Authorization: Bearer <token>` header.

#### Questions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/questions` | Get questions (with filters) |
| GET | `/api/questions/:id` | Get single question |
| GET | `/api/questions/topic/:topicId` | Get questions by topic |

#### Progress

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/progress` | Get user's overall progress |
| POST | `/api/progress/question` | Record question attempt |
| GET | `/api/progress/topic/:topicId` | Get topic-specific progress |
| GET | `/api/progress/questions/:topicId` | Get answered questions in topic |

#### Bookmarks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bookmarks` | Get user's bookmarks |
| POST | `/api/bookmarks` | Add bookmark |
| DELETE | `/api/bookmarks/:questionId` | Remove bookmark |
| GET | `/api/bookmarks/check/:questionId` | Check if bookmarked |

#### Mock Tests

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mock-tests/:id/questions` | Get questions for test |
| POST | `/api/mock-tests/:id/start` | Start test attempt |
| POST | `/api/mock-tests/attempts/:id/submit` | Submit test |
| GET | `/api/mock-tests/attempts/history` | Get test history |

#### Flashcards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/flashcards` | Get flashcards with progress |
| POST | `/api/flashcards/:questionId/review` | Update review status |
| GET | `/api/flashcards/due` | Get cards due for review |
| GET | `/api/flashcards/stats` | Get flashcard statistics |

#### Study Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sessions/start` | Start study session |
| PUT | `/api/sessions/:id/end` | End study session |
| GET | `/api/sessions/recent` | Get recent sessions |
| GET | `/api/sessions/stats` | Get session statistics |

#### User

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/profile` | Get user profile |
| PUT | `/api/user/profile` | Update profile |
| GET | `/api/user/settings` | Get user settings |
| PUT | `/api/user/settings` | Update settings |
| GET | `/api/user/stats` | Get user statistics |
| DELETE | `/api/user/account` | Delete account |

## Project Structure

```
backend/
├── src/
│   ├── index.ts           # Express app entry point
│   ├── lib/
│   │   └── supabase.ts    # Supabase client configuration
│   ├── middleware/
│   │   └── auth.ts        # JWT authentication middleware
│   ├── routes/
│   │   ├── topics.ts
│   │   ├── questions.ts
│   │   ├── progress.ts
│   │   ├── bookmarks.ts
│   │   ├── mock-tests.ts
│   │   ├── flashcards.ts
│   │   ├── sessions.ts
│   │   └── user.ts
│   ├── scripts/
│   │   └── seed-questions.ts
│   └── types/
│       └── database.types.ts
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── tsconfig.json
```

## Authentication

The backend uses Supabase Auth. The frontend gets a JWT token from Supabase which is passed to the backend in the `Authorization` header.

```typescript
// Frontend example
const token = session?.access_token;
fetch('/api/progress', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
```

The backend verifies the token using `supabase.auth.getUser(token)`.

## Database

The backend primarily uses direct Supabase queries, leveraging Row Level Security (RLS) policies defined in the database. This means:

1. Users can only access their own data
2. Topics and questions are publicly readable
3. Progress, bookmarks, etc. are user-scoped

## Notes

- The backend is optional - the frontend can directly use the Supabase client
- The backend is useful for:
  - Complex business logic
  - Data aggregation
  - Rate limiting
  - Caching
  - Admin operations
