import { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Hardcode the exact PFP filenames that exist in public/img/pfps/
  const images = [
    '/img/pfps/9465.png',
    '/img/pfps/9466.png',
    '/img/pfps/9467.png',
    '/img/pfps/9468.png',
    '/img/pfps/9469.png',
    '/img/pfps/9470.png',
    '/img/pfps/9471.png',
    '/img/pfps/9472.png',
    '/img/pfps/9473.png',
    '/img/pfps/9474.png',
    '/img/pfps/9475.png',
    '/img/pfps/9476.png',
    '/img/pfps/9477.png',
    '/img/pfps/9478.png',
    '/img/pfps/9479.png'
  ]
  
  // Double the array for infinite scroll
  const duplicatedImages = [...images, ...images]
  
  res.status(200).json(duplicatedImages)
} 