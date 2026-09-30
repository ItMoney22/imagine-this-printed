// MUST be imported BEFORE any module that constructs an OpenAI/SDK client at module-load time.
// Forces backend/.env to win over OS-level env vars (Windows User-scope OPENAI_API_KEY otherwise sticks).
import dotenv from 'dotenv'
import { loadOpenAIKeyFromSifu } from './sifu-openai.js'
dotenv.config({ override: true })
// With SIFU_APP_TOKEN set, the OpenAI key comes from Sifu's vault, not this env (task bef81073).
loadOpenAIKeyFromSifu()
