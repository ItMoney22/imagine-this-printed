import fetch from 'node-fetch'

// Use Google AI API with API key (simpler than Vertex AI service account)
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY

// Mr. Imagine mockup base URLs
const MR_IMAGINE_MOCKUPS: Record<string, Record<string, Record<string, string>>> = {
  tshirt: {
    front: {
      black: '/mr-imagine/mockups/mr-imagine-tshirt-black-front.png',
      white: '/mr-imagine/mockups/mr-imagine-tshirt-white-front.png',
      gray: '/mr-imagine/mockups/mr-imagine-tshirt-gray-front.png',
    },
    back: {
      black: '/mr-imagine/mockups/mr-imagine-tshirt-black-back.png',
      white: '/mr-imagine/mockups/mr-imagine-tshirt-white-back.png',
      gray: '/mr-imagine/mockups/mr-imagine-tshirt-gray-back.png',
    },
  },
  hoodie: {
    front: {
      black: '/mr-imagine/mockups/mr-imagine-hoodie-black-front.png',
      white: '/mr-imagine/mockups/mr-imagine-hoodie-white-front.png',
    },
    back: {
      black: '/mr-imagine/mockups/mr-imagine-hoodie-black-back.png',
      white: '/mr-imagine/mockups/mr-imagine-hoodie-white-back.png',
    },
  },
  tank: {
    front: {
      black: '/mr-imagine/mockups/mr-imagine-tank-black-front.png',
      white: '/mr-imagine/mockups/mr-imagine-tank-white-front.png',
    },
  },
}

export interface GeminiMockupInput {
  designImageUrl: string
  template?: 'flat_lay' | 'mr_imagine' | 'lifestyle'
  productType?: 'tshirt' | 'hoodie' | 'tank'
  shirtColor?: 'black' | 'white' | 'gray'
  printPlacement?: 'front-center' | 'left-pocket' | 'back-only' | 'pocket-front-back-full'
}

export interface GeminiMockupResult {
  success: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  console.log('[gemini-mockup] Fetching image:', url)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`)
  }
  const buffer = await response.buffer()
  const mimeType = response.headers.get('content-type') || 'image/png'
  const base64 = buffer.toString('base64')
  return { base64, mimeType }
}

export async function generateMockup(input: GeminiMockupInput): Promise<GeminiMockupResult> {
  // VERSION TAG: v2.0 - Template-specific logic fixed 2024-12-08
  console.log('[gemini-mockup] ========== MOCKUP GENERATION v2.0 ==========')
  console.log('[gemini-mockup] Input params:', {
    productType: input.productType,
    shirtColor: input.shirtColor,
    printPlacement: input.printPlacement,
    template: input.template,
  })

  if (!GOOGLE_API_KEY) {
    console.error('[gemini-mockup] GOOGLE_API_KEY not configured')
    return {
      success: false,
      error: 'Google API key not configured',
    }
  }

  try {
    // Determine product type and color
    const productType = input.productType || 'tshirt'
    const shirtColor = input.shirtColor || 'black'
    const printPlacement = input.printPlacement || 'front-center'
    const template = input.template || 'flat_lay'
    const side = printPlacement === 'back-only' ? 'back' : 'front'

    // Map shirt color to descriptive text
    const colorDescriptions: Record<string, string> = {
      black: 'black',
      white: 'white',
      gray: 'heather gray',
    }
    const fabricColor = colorDescriptions[shirtColor] || 'black'

    // Map product type to name
    const productNames: Record<string, string> = {
      tshirt: 't-shirt',
      hoodie: 'hoodie',
      tank: 'tank top',
    }
    const productName = productNames[productType] || 't-shirt'

    // Placement descriptions
    const placementDescriptions: Record<string, string> = {
      'front-center': 'centered on the chest area',
      'left-pocket': 'small, positioned on the left chest pocket area',
      'back-only': 'large, centered on the back',
      'pocket-front-back-full': 'small on the front left pocket and large on the back',
    }
    const placementDesc = placementDescriptions[printPlacement] || 'centered on the chest area'

    // Fetch design image
    console.log('[gemini-mockup] Design image URL:', input.designImageUrl)
    const designImage = await fetchImageAsBase64(input.designImageUrl)

    let prompt: string
    let mockupImage: { base64: string; mimeType: string } | null = null

    // STRICT SEPARATION: Only fetch base image for mr_imagine template
    if (template === 'mr_imagine') {
      // MR. IMAGINE MOCKUP - Composite design onto Mr. Imagine wearing a shirt
      const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV
      const siteUrl = isDev
        ? 'http://localhost:5173'
        : (process.env.FRONTEND_URL || process.env.APP_ORIGIN || 'https://imaginethisprinted.com')

      // Determine expected path
      const mrImagineMockupPath = MR_IMAGINE_MOCKUPS[productType]?.[side]?.[shirtColor] ||
        MR_IMAGINE_MOCKUPS[productType]?.front?.[shirtColor] ||
        MR_IMAGINE_MOCKUPS['tshirt']['front']['black']

      const mrImagineMockupUrl = `${siteUrl}${mrImagineMockupPath}`

      console.log('[gemini-mockup] Template: mr_imagine - Using Mr. Imagine base:', mrImagineMockupUrl)

      try {
        mockupImage = await fetchImageAsBase64(mrImagineMockupUrl)
      } catch (err: any) {
        console.error('[gemini-mockup] ❌ Failed to fetch Mr. Imagine base image:', err.message)
        // Fallback or re-throw? Ideally fail or try generic
        throw new Error(`Failed to fetch Mr. Imagine base image: ${mrImagineMockupUrl}`)
      }

      prompt = `Edit the first image by placing the graphic design from the second image onto the ${productName}.

The first image shows Mr. Imagine, a friendly purple furry mascot character, wearing a plain ${fabricColor} ${productName}.
The second image is a graphic design that needs to be printed on the shirt.

Instructions:
1. Take the graphic from the second image and place it ${placementDesc} on Mr. Imagine's ${productName} in the first image
2. Preserve the exact artwork from the second image - same colors, shapes, and details
3. Make it look like a realistic printed graphic on the fabric, following the shirt's contours
4. Keep Mr. Imagine exactly as shown - only add the graphic to the shirt
5. Use a clean PLAIN WHITE studio background behind Mr. Imagine - this is for e-commerce product display
6. Output a SINGLE high-quality product mockup image showing Mr. Imagine wearing the custom printed ${productName}
7. Do NOT generate multiple images or variations - only ONE final image`

    } else {
      // FLAT LAY / LIFESTYLE - Generate a NEW image (no base image)
      console.log(`[gemini-mockup] Template: ${template} - Generating standalone mockup (NO Mr. Imagine base)`)
      mockupImage = null // Explicitly ensure no base image is used

      const styleDesc = template === 'lifestyle'
        ? `on a model or in a lifestyle setting`
        : `laid flat on a clean surface`

      prompt = `Create a professional product mockup photo of a ${fabricColor} ${productName} ${styleDesc} with a custom printed graphic design.

The image provided is the graphic design that should be printed on the shirt.

Instructions:
1. Generate a photorealistic mockup of a ${fabricColor} ${productName}
2. Place the graphic design ${placementDesc} on the ${productName}
3. The design should look like it's actually printed on the fabric - realistic texture, proper perspective
4. Use professional studio lighting with soft shadows
5. Clean, minimal background
6. E-commerce quality product photography style
7. Preserve the exact artwork - same colors, shapes, and details`
    }

    console.log('[gemini-mockup] Images fetched successfully')

    // Use Gemini 2.5 Flash Image - production-ready model with proper image editing support
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_API_KEY}`

    // Build parts array - include mockup base image only for mr_imagine template
    const parts: any[] = [{ text: prompt }]

    if (mockupImage) {
      // For mr_imagine: include the Mr. Imagine base image first, then the design
      parts.push({
        inline_data: {
          mime_type: mockupImage.mimeType,
          data: mockupImage.base64,
        },
      })
    }

    // Always include the design image
    parts.push({
      inline_data: {
        mime_type: designImage.mimeType,
        data: designImage.base64,
      },
    })

    const requestBody = {
      contents: [
        {
          parts: parts,
        },
      ],
      generationConfig: {
        temperature: 0.2, // Lower temperature for more deterministic single-image output
        topK: 32,
        topP: 0.8,
        maxOutputTokens: 4096,
        candidateCount: 1, // Explicitly request only 1 candidate response
        responseModalities: ['IMAGE'], // Only request image output, not text variations
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_ONLY_HIGH',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_ONLY_HIGH',
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_ONLY_HIGH',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_ONLY_HIGH',
        },
      ],
    }

    console.log('[gemini-mockup] Calling Gemini API...')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[gemini-mockup] Gemini API error:', response.status, errorText)

      // If Gemini 2.5 Flash Image doesn't work, try Imagen 3 as fallback
      // Note: Imagen 3 can only generate from text, not composite actual images
      console.log('[gemini-mockup] Falling back to Imagen 3 (text-to-image only)...')
      return await generateWithImagen3(input, mockupImage, designImage, fabricColor, productName, placementDesc)
    }

    const result = await response.json() as any
    console.log('[gemini-mockup] Gemini response received')

    // Check for image in the response
    if (result.candidates && result.candidates.length > 0) {
      const candidate = result.candidates[0]
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData || part.inline_data) {
            const inlineData = part.inlineData || part.inline_data
            console.log('[gemini-mockup] Found generated image in response')
            return {
              success: true,
              imageBase64: inlineData.data,
              mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
            }
          }
        }

        // Log text response if present
        const textPart = candidate.content.parts.find((p: any) => p.text)
        if (textPart) {
          console.log('[gemini-mockup] Text response:', textPart.text?.substring(0, 200))
        }
      }
    }

    // Check for blocked content
    if (result.promptFeedback?.blockReason) {
      console.error('[gemini-mockup] Content was blocked:', result.promptFeedback.blockReason)
      return {
        success: false,
        error: `Content blocked: ${result.promptFeedback.blockReason}`,
      }
    }

    // If Gemini didn't generate an image, fall back to Imagen 3
    // Note: This is a fallback that generates Mr. Imagine from text (won't composite actual design)
    console.log('[gemini-mockup] Gemini did not generate an image, falling back to Imagen 3 (text-to-image)...')
    return await generateWithImagen3(input, mockupImage, designImage, fabricColor, productName, placementDesc)

  } catch (error: any) {
    console.error('[gemini-mockup] Error generating mockup:', error)
    return {
      success: false,
      error: error.message || 'Unknown error during mockup generation',
    }
  }
}

// Fallback to Imagen 3 for image generation
async function generateWithImagen3(
  input: GeminiMockupInput,
  mockupImage: { base64: string; mimeType: string } | null,
  designImage: { base64: string; mimeType: string },
  fabricColor: string,
  productName: string,
  placementDesc: string
): Promise<GeminiMockupResult> {
  console.log('[gemini-mockup] Using Imagen 3 for mockup generation')

  try {
    // Imagen 3 through Google AI API - correct endpoint with :predict
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict`

    const prompt = `A professional product mockup photo showing Mr. Imagine, a friendly purple furry cartoon mascot character, wearing a ${fabricColor} ${productName} with a custom DTF printed graphic design ${placementDesc}. The character is proudly displaying the custom printed shirt. Professional studio lighting, e-commerce quality product photography, PLAIN WHITE STUDIO BACKGROUND. The printed graphic should look realistic on the fabric. Single character, single image, centered composition.`

    // Correct request format for Imagen 3 predict endpoint
    const requestBody = {
      instances: [
        {
          prompt: prompt,
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: '1:1',
        safetyFilterLevel: 'block_only_high',
        personGeneration: 'allow_adult',
      },
    }

    console.log('[gemini-mockup] Calling Imagen 3 API...')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GOOGLE_API_KEY!,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[gemini-mockup] Imagen 3 API error:', response.status, errorText)
      throw new Error(`Imagen 3 API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json() as any

    // Imagen 3 predict endpoint returns predictions array
    if (result.predictions && result.predictions.length > 0) {
      const prediction = result.predictions[0]
      if (prediction.bytesBase64Encoded) {
        console.log('[gemini-mockup] Imagen 3 generated image successfully')
        return {
          success: true,
          imageBase64: prediction.bytesBase64Encoded,
          mimeType: prediction.mimeType || 'image/png',
        }
      }
    }

    // Check for RAI filtering
    if (result.rai_filtered_reason) {
      console.error('[gemini-mockup] Content filtered:', result.rai_filtered_reason)
      return {
        success: false,
        error: `Content filtered: ${result.rai_filtered_reason}`,
      }
    }

    console.error('[gemini-mockup] No image in Imagen 3 response:', JSON.stringify(result).substring(0, 500))
    return {
      success: false,
      error: 'Imagen 3 did not generate an image',
    }

  } catch (error: any) {
    console.error('[gemini-mockup] Imagen 3 error:', error)
    return {
      success: false,
      error: error.message || 'Unknown error with Imagen 3',
    }
  }
}
