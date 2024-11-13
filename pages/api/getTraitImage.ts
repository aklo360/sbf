import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { category, trait } = req.query
  
  if (!category || !trait) {
    return res.status(400).json({ error: 'Missing category or trait' })
  }

  const traitsDirectory = path.join(process.cwd(), 'public/img/traits', category as string)
  const filename = `${trait}.png`
  
  try {
    const filePath = path.join(traitsDirectory, filename)
    if (fs.existsSync(filePath)) {
      return res.status(200).json({ 
        path: `/img/traits/${category}/${filename}` 
      })
    }
    
    res.status(404).json({ error: 'Trait image not found' })
  } catch (error) {
    console.error('Error finding trait image:', error)
    res.status(500).json({ error: 'Failed to find trait image' })
  }
} 