import { getJson } from 'serpapi'
import OpenAI from 'openai'
import fetch from 'node-fetch'
import * as cheerio from 'cheerio'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export interface SearchResult {
  query: string
  context: string
  sources: string[]
  websiteContent?: string
  officialUrl?: string
  imageDescriptions?: string[]
}

/**
 * Extracts the main topic/subject from a user prompt for better searching
 * Example: "Cool Arc Raiders tshirt" -> "Arc Raiders game"
 */
async function extractSearchTopic(userPrompt: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'Extract ONLY the main topic, game, movie, character, or brand name from the user prompt. Return just the name, nothing else. If it\'s a game, add " game gameplay" after it. If it\'s a movie, add " movie". Examples: "Arc Raiders" -> "Arc Raiders game gameplay", "Halo shirt" -> "Halo game gameplay", "Mario" -> "Super Mario"'
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.3,
      max_tokens: 50,
    })

    const topic = completion.choices[0].message.content?.trim() || userPrompt
    console.log('[serpapi] 📝 Extracted search topic:', topic)
    return topic
  } catch (error) {
    console.error('[serpapi] ⚠️  Failed to extract topic, using original prompt')
    return userPrompt
  }
}

/**
 * Scrapes content from a website for additional context
 */
async function scrapeWebsite(url: string): Promise<string> {
  try {
    console.log('[serpapi] 🌐 Scraping website:', url)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000 // 5 second timeout
    })

    if (!response.ok) {
      console.warn('[serpapi] ⚠️ Website fetch failed:', response.status)
      return ''
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    // Remove script, style, and nav elements
    $('script, style, nav, footer, header').remove()

    // Extract main content from common selectors
    let content = ''
    const selectors = ['main', 'article', '.content', '#content', '.main-content', 'body']

    for (const selector of selectors) {
      const text = $(selector).text().trim()
      if (text.length > content.length) {
        content = text
      }
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
      .substring(0, 2000) // Limit to 2000 chars

    console.log('[serpapi] ✅ Website scraped:', content.length, 'chars')
    return content
  } catch (error: any) {
    console.error('[serpapi] ❌ Website scraping error:', error.message)
    return ''
  }
}

/**
 * Searches Google Images using SerpAPI for visual descriptions
 */
async function searchGoogleImages(query: string, apiKey: string): Promise<string[]> {
  try {
    console.log('[serpapi] 🖼️ Searching Google Images for:', query)

    const response = await getJson({
      engine: 'google_images',
      q: query,
      api_key: apiKey,
      num: 5
    })

    const images = response.images_results || []
    const descriptions: string[] = []

    for (const img of images.slice(0, 5)) {
      if (img.title) descriptions.push(img.title)
      if (img.snippet) descriptions.push(img.snippet)
    }

    console.log('[serpapi] ✅ Found', descriptions.length, 'image descriptions')
    return descriptions
  } catch (error: any) {
    console.error('[serpapi] ❌ Image search error:', error.message)
    return []
  }
}

/**
 * Lean trend search for design-idea generation. Pulls organic snippets + Google
 * Images titles for a query (no topic extraction, no scraping) so it's fast
 * enough to run on a "Surprise me" tap. Returns a compact text blob of real,
 * current signals to ground the idea generator. Empty string if unavailable.
 */
export async function searchTrends(query: string): Promise<string> {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    console.warn('[serpapi] ⚠️ SERPAPI_API_KEY not set — trend search skipped')
    return ''
  }
  try {
    const [web, imgs] = await Promise.all([
      getJson({ engine: 'google', q: query, api_key: apiKey, num: 6 }).catch(() => ({} as any)),
      getJson({ engine: 'google_images', q: query, api_key: apiKey, num: 10 }).catch(() => ({} as any)),
    ])
    const snippets: string[] = (web.organic_results || [])
      .slice(0, 6)
      .map((r: any) => (r.title && r.snippet ? `${r.title}: ${r.snippet}` : r.snippet))
      .filter(Boolean)
    const imgTitles: string[] = (imgs.images_results || [])
      .slice(0, 12)
      .map((i: any) => i.title)
      .filter(Boolean)
    const blob = [...snippets, ...imgTitles].join('\n').slice(0, 1800)
    console.log('[serpapi] 🔥 Trend search:', query, '->', blob.length, 'chars')
    return blob
  } catch (error: any) {
    console.error('[serpapi] ❌ Trend search error:', error.message)
    return ''
  }
}

/**
 * Searches Google using SerpAPI to get context about the user's query
 * This helps GPT understand current trends, games, movies, etc.
 */
export async function searchForContext(query: string): Promise<SearchResult> {
  console.log('[serpapi] 🔍 Original query:', query)

  // Extract just the topic for better search results
  const searchTopic = await extractSearchTopic(query)
  console.log('[serpapi] 🔍 Searching for:', searchTopic)

  try {
    const apiKey = process.env.SERPAPI_API_KEY

    if (!apiKey) {
      console.warn('[serpapi] ⚠️  SERPAPI_API_KEY not configured, skipping search')
      return {
        query,
        context: '',
        sources: []
      }
    }

    const response = await getJson({
      engine: 'google',
      q: searchTopic, // Use extracted topic instead of full query
      api_key: apiKey,
      num: 5 // Get top 5 results
    })

    // Extract relevant context from search results
    const organicResults = response.organic_results || []
    const knowledgeGraph = response.knowledge_graph || {}

    let context = ''
    const sources: string[] = []

    // Add knowledge graph info (usually most relevant)
    if (knowledgeGraph.title && knowledgeGraph.description) {
      context += `${knowledgeGraph.title}: ${knowledgeGraph.description}\n`
      if (knowledgeGraph.type) {
        context += `Type: ${knowledgeGraph.type}\n`
      }
    }

    // Add top organic search results
    for (const result of organicResults.slice(0, 3)) {
      if (result.snippet) {
        context += `\n${result.snippet}`
        sources.push(result.link)
      }
    }

    // If we got no context, try answer box
    if (!context && response.answer_box) {
      const answerBox = response.answer_box
      if (answerBox.answer) {
        context = answerBox.answer
      } else if (answerBox.snippet) {
        context = answerBox.snippet
      }
    }

    console.log('[serpapi] ✅ Found context:', context.substring(0, 200) + '...')
    console.log('[serpapi] 📚 Sources:', sources.length)

    // Step 2: Search Google Images for visual descriptions
    const imageDescriptions = await searchGoogleImages(searchTopic, apiKey)

    // Step 3: Try to find and scrape official website
    let websiteContent = ''
    let officialUrl = ''

    // Look for official website in organic results or knowledge graph
    const potentialOfficialSites = [
      ...(knowledgeGraph.website ? [knowledgeGraph.website] : []),
      ...organicResults.slice(0, 3).map((r: any) => r.link).filter((url: string) =>
        url && (
          url.includes('.com/') ||
          url.includes('.org/') ||
          url.includes('.gg/') ||
          url.includes('.net/')
        ) && !url.includes('wiki')
      )
    ]

    // Try to scrape the first potential official site
    for (const url of potentialOfficialSites) {
      console.log('[serpapi] 🎯 Attempting to scrape potential official site:', url)
      websiteContent = await scrapeWebsite(url)
      if (websiteContent.length > 100) {
        officialUrl = url
        console.log('[serpapi] ✅ Successfully scraped official site:', url)
        break
      }
    }

    // Combine all context
    let fullContext = context

    if (imageDescriptions.length > 0) {
      fullContext += '\n\nVisual descriptions from images:\n' + imageDescriptions.slice(0, 5).join('; ')
    }

    if (websiteContent) {
      fullContext += '\n\nOfficial website content:\n' + websiteContent.substring(0, 1000)
    }

    console.log('[serpapi] 🎉 Total context length:', fullContext.length, 'chars')
    console.log('[serpapi] 📊 Context breakdown: text=' + context.length + ', images=' + (imageDescriptions.length * 50) + ', website=' + websiteContent.length)

    return {
      query,
      context: fullContext.trim(),
      sources,
      websiteContent,
      officialUrl,
      imageDescriptions
    }
  } catch (error: any) {
    console.error('[serpapi] ❌ Search error:', error.message)
    return {
      query,
      context: '',
      sources: []
    }
  }
}
