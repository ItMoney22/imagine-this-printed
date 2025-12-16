import 'dotenv/config'

console.log('NODE_ENV:', process.env.NODE_ENV)
console.log('typeof NODE_ENV:', typeof process.env.NODE_ENV)
console.log('isDev check 1:', process.env.NODE_ENV === 'development')
console.log('isDev check 2:', !process.env.NODE_ENV)
console.log('Combined:', process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)
