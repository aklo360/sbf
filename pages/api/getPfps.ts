import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const pfpsDirectory = path.join(process.cwd(), 'public/img/pfps')
  
  try {
    const fileNames = fs.readdirSync(pfpsDirectory)
    const pngFiles = fileNames
      .filter(file => file.endsWith('.png'))
      .map(file => `/img/pfps/${file}`)
    
    res.status(200).json(pngFiles)
  } catch (error) {
    console.error('Error reading pfps directory:', error)
    res.status(500).json({ error: 'Failed to read pfps directory' })
  }
} 