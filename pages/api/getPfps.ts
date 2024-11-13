import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const pfpsDirectory = path.join(process.cwd(), 'public/img/pfps')
    
    // Check if directory exists
    if (!fs.existsSync(pfpsDirectory)) {
      console.warn('PFPs directory not found:', pfpsDirectory)
      return res.status(200).json([])
    }

    const fileNames = fs.readdirSync(pfpsDirectory)
    const pngFiles = fileNames
      .filter(file => file.endsWith('.png'))
      .map(file => `/img/pfps/${file}`)
    
    res.status(200).json(pngFiles)
  } catch (error) {
    console.error('Error reading pfps directory:', error)
    res.status(200).json([]) // Return empty array instead of error
  }
} 