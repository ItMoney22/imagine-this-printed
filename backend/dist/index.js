import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { nanoid } from 'nanoid';
import accountRoutes from './routes/account.js';
import healthRoutes from './routes/health.js';
import webhooksRoutes from './routes/webhooks.js';
import userRoutes from './routes/user.js';
import { requireAuth } from './middleware/supabaseAuth.js';
dotenv.config();
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname'
        }
    } : undefined
});
const tail = (s) => s ? `...${s.slice(-4)}` : 'none';
logger.info({
    env: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT || 4000,
        BREVO_API_KEY: !!process.env.BREVO_API_KEY,
        BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
        BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
        FRONTEND_URL: process.env.FRONTEND_URL,
        DATABASE_URL: !!process.env.DATABASE_URL,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
        JWT_SECRET: !!process.env.JWT_SECRET,
    }
}, 'Environment variables loaded');
const app = express();
const PORT = process.env.PORT || 4000;
const prisma = new PrismaClient();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const corsOptions = {
    origin: allowedOrigins.length > 0 ? allowedOrigins : [/^https:\/\/.*imaginethisprinted\.com$/],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(pinoHttp({
    logger,
    genReqId: () => nanoid(10),
    customLogLevel: (req, res, err) => {
        if (res.statusCode >= 500 || err)
            return 'error';
        if (res.statusCode >= 400)
            return 'warn';
        return 'info';
    },
    customSuccessMessage: (req, res) => {
        return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage: (req, res, err) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
    }
}));
app.use('/api/auth', accountRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/users', userRoutes);
app.get('/api/auth/me', requireAuth, (req, res) => {
    return res.json({ ok: true, user: req.user });
});
app.get('/', (req, res) => {
    res.status(200).json({
        service: 'imagine-this-printed-api',
        status: 'ok'
    });
});
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});
app.use((err, req, res, next) => {
    req.log.error({ err }, 'Unhandled error');
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await prisma.$disconnect();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await prisma.$disconnect();
    process.exit(0);
});
app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📡 API available at http://localhost:${PORT}`);
    logger.info(`🏥 Health check: http://localhost:${PORT}/api/health`);
});
export default app;
//# sourceMappingURL=index.js.map