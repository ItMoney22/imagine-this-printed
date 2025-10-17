import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const hashPassword = async (password) => {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
};
const verifyPassword = async (password, hash) => {
    return bcrypt.compare(password, hash);
};
const generateToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
};
const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch (error) {
        return null;
    }
};
const authenticateUser = async (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (!payload)
        return null;
    const user = await prisma.userProfile.findUnique({
        where: { id: payload.id },
        include: { wallet: true }
    });
    return user;
};
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const user = await prisma.userProfile.findUnique({
            where: { email },
            include: { wallet: true }
        });
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        const isValidPassword = await verifyPassword(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        const token = generateToken({
            id: user.id,
            email: user.email,
            role: user.role
        });
        return res.status(200).json({ user, token });
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/register', async (req, res) => {
    try {
        const { email, password, userData } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const existingUser = await prisma.userProfile.findUnique({
            where: { email }
        });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        const hashedPassword = await hashPassword(password);
        const username = email.split('@')[0];
        const displayName = userData?.firstName && userData?.lastName
            ? `${userData.firstName} ${userData.lastName}`.trim()
            : userData?.firstName || 'User';
        const user = await prisma.userProfile.create({
            data: {
                email,
                passwordHash: hashedPassword,
                username,
                displayName,
                firstName: userData?.firstName,
                lastName: userData?.lastName,
                role: 'customer',
                emailVerified: false,
                profileCompleted: false,
                preferences: {},
                metadata: {},
                wallet: {
                    create: {
                        pointsBalance: 0,
                        itcBalance: 0,
                        lifetimePointsEarned: 0,
                        lifetimeItcEarned: 0,
                        walletStatus: 'active'
                    }
                }
            },
            include: {
                wallet: true
            }
        });
        const token = generateToken({
            id: user.id,
            email: user.email,
            role: user.role
        });
        return res.status(201).json({ user, token });
    }
    catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/me', async (req, res) => {
    try {
        const user = await authenticateUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.status(200).json({ user });
    }
    catch (error) {
        console.error('Me endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/profile', async (req, res) => {
    try {
        const { username, userId } = req.query;
        const currentUser = await authenticateUser(req);
        let profileData = null;
        if (userId) {
            profileData = await prisma.userProfile.findUnique({
                where: { id: userId },
                include: { wallet: true }
            });
        }
        else if (username) {
            profileData = await prisma.userProfile.findUnique({
                where: { username: username },
                include: { wallet: true }
            });
        }
        if (!profileData && currentUser && (userId === currentUser.id || username === currentUser.username)) {
            const defaultProfile = {
                id: currentUser.id,
                email: currentUser.email,
                username: currentUser.username,
                displayName: currentUser.displayName || 'User',
                firstName: currentUser.firstName,
                lastName: currentUser.lastName,
                bio: '',
                avatarUrl: null,
                role: 'customer',
                emailVerified: currentUser.emailVerified,
                profileCompleted: false,
                preferences: {},
                metadata: {},
                passwordHash: currentUser.passwordHash
            };
            profileData = await prisma.userProfile.create({
                data: defaultProfile,
                include: { wallet: true }
            });
        }
        if (!profileData) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        const orderStats = await prisma.order.findMany({
            where: { userId: profileData.id },
            select: { total: true }
        });
        const totalOrders = orderStats.length;
        const totalSpent = orderStats.reduce((sum, order) => sum + (order.total || 0), 0);
        const isOwnProfile = currentUser && currentUser.id === profileData.id;
        const userProfile = {
            id: profileData.id,
            userId: profileData.id,
            username: profileData.username,
            displayName: profileData.displayName,
            bio: profileData.bio || '',
            profileImage: profileData.avatarUrl || null,
            location: profileData.phone || '',
            website: profileData.companyName || '',
            socialLinks: profileData.preferences || {},
            isPublic: true,
            showOrderHistory: false,
            showDesigns: true,
            showModels: true,
            joinedDate: profileData.createdAt.toISOString(),
            totalOrders,
            totalSpent,
            favoriteCategories: [],
            badges: [],
            isOwnProfile
        };
        return res.status(200).json(userProfile);
    }
    catch (error) {
        console.error('Profile get error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/profile', async (req, res) => {
    try {
        const user = await authenticateUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const { username, displayName, bio, location, website, socialLinks, avatarUrl, isPublic, showOrderHistory, showDesigns, showModels } = req.body;
        if (!username || !displayName) {
            return res.status(400).json({ error: 'Username and display name are required' });
        }
        const profileData = {
            username,
            displayName,
            bio: bio || '',
            phone: location || '',
            companyName: website || '',
            preferences: socialLinks || {},
            avatarUrl: avatarUrl || null,
            profileCompleted: true
        };
        const existingProfile = await prisma.userProfile.findUnique({
            where: { id: user.id },
            select: { id: true }
        });
        if (existingProfile) {
            await prisma.userProfile.update({
                where: { id: user.id },
                data: profileData
            });
        }
        else {
            await prisma.userProfile.create({
                data: {
                    ...profileData,
                    id: user.id,
                    email: user.email,
                    role: 'customer',
                    emailVerified: user.emailVerified,
                    passwordHash: user.passwordHash
                }
            });
        }
        return res.status(200).json({ message: 'Profile updated successfully' });
    }
    catch (error) {
        console.error('Profile update error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/wallet', async (req, res) => {
    try {
        const user = await authenticateUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const walletData = await prisma.userWallet.findUnique({
            where: { userId: user.id },
            select: {
                pointsBalance: true,
                itcBalance: true
            }
        });
        const pointsData = await prisma.pointsTransaction.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        const itcData = await prisma.itcTransaction.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        return res.status(200).json({
            pointsBalance: walletData?.pointsBalance || 0,
            itcBalance: Number(walletData?.itcBalance || 0),
            pointsHistory: pointsData || [],
            itcHistory: itcData || []
        });
    }
    catch (error) {
        console.error('Wallet get error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
//# sourceMappingURL=account.js.map