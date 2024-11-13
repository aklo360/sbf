import Head from 'next/head'
import { useState, useEffect, Fragment } from 'react'
import styles from '@/styles/Home.module.css'
import Image from 'next/image'

// Custom interfaces for NFT traits rarity
interface TraitRarity {
  trait_type: string;
  value: string;
  count: number;
  percentage: number;
}

interface TraitCategory {
  category: string;
  traits: TraitRarity[];
}

export default function Home() {
  const [nftImages, setNftImages] = useState<string[]>([])
  const [traitCategories, setTraitCategories] = useState<TraitCategory[]>([])
  const [traitImages, setTraitImages] = useState<Record<string, string>>({})
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [activeFilters, setActiveFilters] = useState<Record<string, boolean>>({
    common: true,
    uncommon: true,
    rare: true,
    mythic: true
  })

  // Calculate rarity tier based on percentage
  const getRarityTier = (percentage: number): string => {
    if (percentage < 1) return 'mythic'
    if (percentage < 3) return 'rare'
    if (percentage < 7) return 'uncommon'
    return 'common'
  }

  // Preload images
  const preloadImage = (src: string) => {
    return new Promise<void>((resolve, reject) => {
      const img = document.createElement('img')
      img.src = src
      img.onload = () => resolve()
      img.onerror = () => reject()
    })
  }

  const toggleSection = (category: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [category]: !prev[category]
    }))
  }

  const toggleFilter = (rarity: string) => {
    setActiveFilters(prev => ({
      ...prev,
      [rarity]: !prev[rarity]
    }))
  }

  useEffect(() => {
    // Fetch PFP images from API
    fetch('/api/getPfps')
      .then(response => {
        if (!response.ok) {
          console.warn('PFPs API returned:', response.status)
          return { pfps: [] }
        }
        return response.json()
      })
      .then(data => {
        const pfpImages = Array.isArray(data) ? data : []
        setNftImages([...pfpImages, ...pfpImages])
      })
      .catch(error => {
        console.error('Error loading PFPs:', error)
        setNftImages([])
      })

    // Parse CSV data and organize by categories
    fetch('/rarity.csv')
      .then(response => {
        if (!response.ok) {
          console.warn('CSV file returned:', response.status)
          return ''
        }
        return response.text()
      })
      .then(async csv => {
        if (!csv) {
          setTraitCategories([])
          return
        }
        const lines = csv.split('\n')
        let currentCategory = ''
        const traits: TraitCategory[] = []
        let currentTraits: TraitRarity[] = []
        const imageCache: Record<string, string> = {}

        for (const line of lines) {
          const [attr, count, percentage] = line.split(',')
          if (!attr?.trim() || attr === 'Attribute') continue
          
          if (!count && !percentage) {
            if (currentCategory && currentTraits.length) {
              traits.push({ category: currentCategory, traits: currentTraits })
            }
            currentCategory = attr
            currentTraits = []
          } else if (count && percentage) {
            currentTraits.push({
              trait_type: currentCategory,
              value: attr,
              count: parseInt(count),
              percentage: parseFloat(percentage)
            })

            // Build image path directly
            const imagePath = `/img/traits/${currentCategory}/${attr}.png`
            imageCache[`${currentCategory}-${attr}`] = imagePath

            // Preload the image
            try {
              await preloadImage(imagePath)
            } catch (err) {
              console.warn(`Failed to preload ${imagePath}`)
            }
          }
        }
        
        if (currentCategory && currentTraits.length) {
          traits.push({ category: currentCategory, traits: currentTraits })
        }

        setTraitCategories(traits)
        setTraitImages(imageCache)
      })
      .catch(error => {
        console.error('Error loading rarity data:', error)
        setTraitCategories([])
      })
  }, [])

  return (
    <>
      <Head>
        <title>Solana Business Frogs</title>
        <meta name="description" content="Solana Business Frogs is the first 10k collection to mint out via bonding curve on Curved.wtf, the PumpFun of NFTs. Classic 24x24px dimensions &amp; iconic traits inspired by CryptoPunks, SMBs, ThugBirdz &amp; more on an all original base character." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/img/logo.png" />
        
        {/* Open Graph / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://solanabusinessfrogs.com/" />
        <meta property="og:title" content="Solana Business Frogs" />
        <meta property="og:description" content="Solana Business Frogs is the first 10k collection to mint out via bonding curve on Curved.wtf, the PumpFun of NFTs. Classic 24x24px dimensions &amp; iconic traits inspired by CryptoPunks, SMBs, ThugBirdz &amp; more on an all original base character." />
        <meta property="og:image" content="https://solanabusinessfrogs.com/img/logo.png" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content="https://solanabusinessfrogs.com/" />
        <meta name="twitter:title" content="Solana Business Frogs" />
        <meta name="twitter:description" content="Solana Business Frogs is the first 10k collection to mint out via bonding curve on Curved.wtf, the PumpFun of NFTs. Classic 24x24px dimensions &amp; iconic traits inspired by CryptoPunks, SMBs, ThugBirdz &amp; more on an all original base character." />
        <meta name="twitter:image" content="https://solanabusinessfrogs.com/img/logo.png" />
        <meta name="twitter:creator" content="@SolanaBFS" />
      </Head>

      <main className={styles.main}>
        {/* Hero Section */}
        <section className={styles.hero}>
          <Image 
            src="/img/logo.png" 
            alt="SBF Logo" 
            width={300}
            height={300}
            className={styles.logo}
            priority
          />
          <h1 className={styles.title}>Solana Business Frogs</h1>
          <p className={styles.description}>
            Solana Business Frogs is the first 10k collection to mint out via bonding curve on Curved.wtf, the PumpFun of NFTs. Classic 24x24px dimensions &amp; iconic traits inspired by CryptoPunks, SMBs, ThugBirdz &amp; more on an all original base character.
          </p>
        </section>

        {/* Links Section - Moved above carousel */}
        <section className={styles.links}>
          <h2>Return to frog 🐸</h2>
          <div className={styles.socialLinks}>
            <a href="https://twitter.com/SolanaBFS" target="_blank" rel="noopener noreferrer">Twitter</a>
            <a href="https://t.me/solbusinessfrogs" target="_blank" rel="noopener noreferrer">Telegram</a>
            <a href="https://magiceden.io/marketplace/solana_business_frogs" target="_blank" rel="noopener noreferrer">Magic Eden</a>
          </div>
        </section>

        {/* NFT Carousel Section */}
        <section className={styles.carouselSection}>
          <div className={styles.carousel}>
            {nftImages.map((img, index) => (
              <Image 
                key={index} 
                src={img} 
                alt={`SBF #${index + 1}`}
                width={300}
                height={300}
                className={styles.carouselItem}
              />
            ))}
          </div>
        </section>

        {/* Utility Section */}
        <section className={styles.utility}>
          <h2 className={styles.utilityTitle}>wHaT&apos;s ThE uTiLiTy?</h2>
          <p className={styles.utilityText}>
            There is NO UTILITY or &quot;ROADMAP&quot;. These frogs were launched just like a memecoin, on a bonding curve that permanently locks liquidity, so you can always sell back into it via Curved.wtf (creators received no funds from this mint).
            <br />
            <br />
            Solana Business Frogs are a collection of 1/1 digital artworks and social avatars meant to be collected and traded like toys or comic books, with provenance and ownership secured and decentralized by the Solana blockchain.
            <br />
            <br />
            Let&apos;s make NFTs fun again.
          </p>
        </section>

        {/* Updated Rarity Section */}
        <section className={styles.rarity}>
          <h2 className={styles.rarityTitle}>Rarity Table</h2>
          <div className={styles.rarityKey}>
            {[['common', '7%+'], ['uncommon', '<7%'], ['rare', '<3%'], ['mythic', '<1%']].map(([rarity, threshold]) => (
              <div
                key={rarity}
                className={`${styles.keyItem} ${styles[rarity]} ${!activeFilters[rarity] ? styles.inactive : ''}`}
                onClick={() => toggleFilter(rarity)}
              >
                {rarity.charAt(0).toUpperCase() + rarity.slice(1)} {threshold}
              </div>
            ))}
          </div>
          <div className={styles.rarityTable}>
            <div className={styles.tableHeader}></div>
            <div className={styles.tableBody}>
              {traitCategories.map((category, idx) => (
                <Fragment key={idx}>
                  <div 
                    className={`${styles.attributeHeader} ${collapsedSections[category.category] ? styles.collapsed : ''}`}
                    onClick={() => toggleSection(category.category)}
                  >
                    <span>{category.category}</span>
                    <span className={styles.collapseIcon}>
                      {collapsedSections[category.category] ? '▼' : '▲'}
                    </span>
                  </div>
                  <div className={`${styles.traitSection} ${collapsedSections[category.category] ? styles.hidden : ''}`}>
                    {category.traits
                      .filter(trait => activeFilters[getRarityTier(trait.percentage)])
                      .map((trait, index) => (
                        <div 
                          key={`${category.category}-${index}`}
                          className={`${styles.tableRow} ${styles[getRarityTier(trait.percentage)]}`}
                        >
                          <div className={styles.imageCell}>
                            {traitImages[`${category.category}-${trait.value}`] && (
                              <Image 
                                src={traitImages[`${category.category}-${trait.value}`]}
                                alt={trait.value}
                                width={128}
                                height={128}
                                className={styles.traitImage}
                              />
                            )}
                          </div>
                          <div className={styles.nameCell}>{trait.value}</div>
                          <div className={styles.rarityCell}>{trait.percentage}%</div>
                        </div>
                      ))}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* Footer Section */}
        <footer className={styles.footer}>
          <div className={styles.footerContent}>
            <div className={styles.footerTop}>
              Created by Pixel Pushers 
              <a 
                href="https://x.com/pxpushers" 
                target="_blank" 
                rel="noopener noreferrer"
                className={styles.footerLogoLink}
              >
                <Image 
                  src="/img/pxplogo.svg" 
                  alt="Pixel Pushers Logo" 
                  width={24}
                  height={24}
                  className={styles.footerLogo}
                />
              </a>
            </div>
            <div className={styles.footerBottom}>
              CC0 No Rights Reserved 2024
            </div>
          </div>
        </footer>
      </main>
    </>
  )
}
