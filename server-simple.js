import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-minimum-32-characters-long';

const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

// Auth endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.userProfile.findUnique({
      where: { email: email.toLowerCase() },
      include: { wallet: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const userResponse = {
      id: user.id,
      email: user.email,
      role: user.role,
      username: user.username,
      displayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
      profileCompleted: user.profileCompleted,
      wallet: user.wallet ? {
        pointsBalance: user.wallet.pointsBalance,
        itcBalance: parseFloat(user.wallet.itcBalance.toString())
      } : null
    };

    res.json({ user: userResponse, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const existingUser = await prisma.userProfile.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Generate username
    const username = email.split('@')[0] + '_' + Math.random().toString(36).substring(2, 6);
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.userProfile.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        username,
        firstName: firstName || '',
        lastName: lastName || '',
        emailVerified: true,
        profileCompleted: false,
        wallet: {
          create: {
            pointsBalance: 1000,
            itcBalance: 10.00,
            lifetimePointsEarned: 1000
          }
        }
      },
      include: { wallet: true }
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const userResponse = {
      id: user.id,
      email: user.email,
      role: user.role,
      username: user.username,
      displayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
      profileCompleted: user.profileCompleted,
      wallet: {
        pointsBalance: user.wallet.pointsBalance,
        itcBalance: parseFloat(user.wallet.itcBalance.toString())
      }
    };

    res.status(201).json({ user: userResponse, token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// Handle client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📊 Health: http://localhost:${port}/api/health`);
});