// MUST be imported BEFORE any module that constructs an OpenAI/SDK client at module-load time.
// Forces backend/.env to win over OS-level env vars (Windows User-scope OPENAI_API_KEY otherwise sticks).
import dotenv from 'dotenv'
dotenv.config({ override: true })
