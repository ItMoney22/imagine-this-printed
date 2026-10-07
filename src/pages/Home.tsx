import React from 'react'
import { HomeHero, TrustStrip } from '../components/home/HomeHero'
import { CategoryDoors } from '../components/home/CategoryDoors'
import { SeasonalPicks, PopularGrid } from '../components/home/HomeShelves'
import { ToyBand, HowItsMade, DesignBand } from '../components/home/HomeBands'
import { useHomeShop } from '../components/home/useHomeShop'
import '../components/home/home.css'

/**
 * Home, remodelled to the mock David approved on 2026-10-07 (approval
 * 7eb9469c, task b9656cc9): one job, get a shopper to a product. Hero with one
 * button, four true facts, category doors, the season's real listings, the
 * popular grid, then the toy factory, how it's made and design-your-own.
 *
 * Gone on purpose: the creator 15% pitch, the "thousands of customers" claim,
 * Mr. Imagine's Santa video, the Why-choose-us boxes, the blank-tee price block
 * (Blank Tees is a door now) and the duplicate recommendations box. A reviews
 * row comes back only with real Etsy reviews (task 36222110; the shop had none
 * on 2026-10-07).
 */
const Home: React.FC = () => {
  const shop = useHomeShop()
  return (
    <div className="home-root bg-bg">
      <HomeHero />
      <TrustStrip />
      <CategoryDoors counts={shop.counts} loading={shop.loading} />
      <SeasonalPicks products={shop.seasonal} />
      <PopularGrid products={shop.popular} loading={shop.loading} />
      <ToyBand toys={shop.toys} toyFrom={shop.toyFrom} />
      <HowItsMade />
      <DesignBand />
    </div>
  )
}

export default Home
