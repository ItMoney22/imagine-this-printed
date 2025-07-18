import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
app.use(cookieParser());

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.userProfile.findUnique({
      where: { id: decoded.userId },
      include: { wallet: true }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Health check endpoint
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

    // Update last active
    await prisma.userProfile.update({
      where: { id: user.id },
      data: { lastActive: new Date() }
    });

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

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if user already exists
    const existingUser = await prisma.userProfile.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Generate username from email
    const username = email.split('@')[0] + '_' + Math.random().toString(36).substring(2, 6);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user with wallet
    const user = await prisma.userProfile.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        username,
        firstName: firstName || '',
        lastName: lastName || '',
        emailVerified: true, // Auto-verify for now
        profileCompleted: false,
        wallet: {
          create: {
            pointsBalance: 1000, // Sign-up bonus
            itcBalance: 10.00,   // Welcome ITC
            lifetimePointsEarned: 1000
          }
        }
      },
      include: { wallet: true }
    });

    // Create welcome points transaction
    await prisma.pointsTransaction.create({
      data: {
        userId: user.id,
        type: 'bonus',
        amount: 1000,
        balanceAfter: 1000,
        reason: 'Welcome bonus - thank you for joining!',
        source: 'signup'
      }
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

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = req.user;
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

  res.json({ user: userResponse });
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await prisma.userProfile.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      // Don't reveal if email exists or not
      return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    // TODO: Implement actual email sending
    // For now, just return success
    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle client-side routing - this must be last
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 ImagineThisPrinted server running on port ${port}`);
  console.log(`📊 Health check: http://localhost:${port}/api/health`);
});