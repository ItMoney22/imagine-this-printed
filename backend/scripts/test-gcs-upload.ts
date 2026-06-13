import { uploadImageFromBuffer } from '../services/google-cloud-storage.js';
import fs from 'fs';

async function test() {
  try {
    console.log('Testing GCS upload...');
    const buffer = Buffer.from('test-image-data');
    const result = await uploadImageFromBuffer(buffer, 'test/test-upload.txt', 'text/plain');
    console.log('Upload success:', result);
  } catch (error) {
    console.error('Upload failed:', error);
  }
}

test();
