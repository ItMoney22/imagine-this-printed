import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function testAuth() {
  console.log('🔍 Checking test users...');
  
  const users = await prisma.userProfile.findMany({
    where: { email: { contains: 'test' } },
    select: { email: true, firstName: true, lastName: true, id: true }
  });
  
  console.log('Test users found:', users);
  
  if (users.length === 0) {
    console.log('❌ No test users found');
    await prisma.$disconnect();
    return;
  }
  
  // Test login with API
  const testEmail = 'test1@imaginethisprinted.com';
  const testPassword = 'TestPass123!';
  
  console.log(`\n🔄 Testing login API with ${testEmail}...`);
  
  try {
    const response = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Login successful!');
      console.log('User:', data.user.email, data.user.firstName, data.user.lastName);
      console.log('Points:', data.user.wallet?.pointsBalance);
      console.log('Token:', data.token ? 'Generated' : 'Missing');
    } else {
      console.log('❌ Login failed:', data.error);
      
      // Check if user exists and test password directly
      const user = await prisma.userProfile.findUnique({
        where: { email: testEmail }
      });
      
      if (user) {
        console.log('User exists in DB');
        const isValid = await bcrypt.compare(testPassword, user.passwordHash);
        console.log('Password valid:', isValid);
      } else {
        console.log('User not found in DB');
      }
    }
    
  } catch (error) {
    console.error('❌ API test failed:', error.message);
  }
  
  await prisma.$disconnect();
}

testAuth().catch(console.error);