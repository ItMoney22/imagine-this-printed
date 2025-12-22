import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Conversation state tracking - NEW FLOW
interface ConversationState {
  step: 'greeting' | 'exploring' | 'refining' | 'confirm_design' | 'generating' | 'select_design' | 'garment_options' | 'final_confirm' | 'complete'
  collectedData: {
    // Design concept (collected during conversation)
    designConcept?: string // The full design description
    style?: string
    theme?: string
    colors?: string[]
    text?: string
    mood?: string

    // Image style (photorealistic vs cartoon) - MAPS TO FRONTEND FORM
    imageStyle?: 'realistic' | 'cartoon'

    // Generated designs (after confirmation)
    generatedDesigns?: Array<{
      modelId: string
      modelName: string
      imageUrl?: string
      status: string
    }>
    selectedDesignIndex?: number

    // Garment options (AFTER design selection)
    productType?: 'tshirt' | 'hoodie' | 'tank'
    shirtColor?: 'black' | 'white' | 'gray'
    printPlacement?: 'front-center' | 'left-pocket' | 'back-only'
  }
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string }>
}

// In-memory conversation storage (in production, use Redis or database)
const conversations = new Map<string, ConversationState>()

/**
 * Get or initialize conversation state for a user
 */
function getConversationState(userId: string): ConversationState {
  if (!conversations.has(userId)) {
    conversations.set(userId, {
      step: 'greeting',
      collectedData: {},
      conversationHistory: [],
    })
  }
  return conversations.get(userId)!
}

/**
 * Mr. Imagine - Design Creation Companion
 * The beloved mascot of ImagineThisPrinted who helps users create custom products!
 *
 * FLOW:
 * 1. greeting - Welcome and start exploring
 * 2. exploring - Natural conversation about their vision (can change mind, refine ideas)
 * 3. refining - Help them clarify and finalize design concept
 * 4. confirm_design - Summarize and confirm DESIGN concept before generation
 * 5. generating - Generate 3 options from different AI models
 * 6. select_design - User picks their favorite design
 * 7. garment_options - ONLY NOW ask about shirt color, product type, placement
 * 8. final_confirm - Confirm everything before checkout
 * 9. complete - Done!
 */
export async function generateAssistantResponse(
  userId: string,
  userMessage: string
): Promise<{
  text: string
  nextPrompt: string
  isComplete: boolean
  readyToGenerate?: boolean
  designConcept?: string
  garmentReady?: boolean
  collectedData?: ConversationState['collectedData']
}> {
  const state = getConversationState(userId)

  // Add user message to history
  state.conversationHistory.push({ role: 'user', content: userMessage })

  console.log('[assistant] 💬 Processing user message:', {
    userId,
    step: state.step,
    message: userMessage.substring(0, 50) + '...',
    historyLength: state.conversationHistory.length,
  })

  // Build context-aware system prompt
  const systemPrompt = buildSystemPrompt(state)

  try {
    // Generate AI response using GPT-4
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...state.conversationHistory.slice(-10), // Keep last 10 exchanges for context
    ]

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_completion_tokens: 80, // Keep responses SHORT - user can't interrupt
      temperature: 0.8,
    })

    const assistantText = completion.choices[0].message.content || 'Hmm, I had trouble with that. Could you say it again?'

    // Add assistant response to history
    state.conversationHistory.push({ role: 'assistant', content: assistantText })

    // Update conversation state based on the interaction
    const stateChange = analyzeAndUpdateState(state, userMessage, assistantText)

    // Determine what to return
    const nextPrompt = generateNextPrompt(state)
    const isComplete = state.step === 'complete'

    console.log('[assistant] ✅ Response generated:', {
      step: state.step,
      responseLength: assistantText.length,
      isComplete,
      readyToGenerate: stateChange.readyToGenerate,
      garmentReady: stateChange.garmentReady,
    })

    return {
      text: assistantText,
      nextPrompt,
      isComplete,
      readyToGenerate: stateChange.readyToGenerate,
      designConcept: stateChange.readyToGenerate ? state.collectedData.designConcept : undefined,
      garmentReady: stateChange.garmentReady,
      collectedData: state.collectedData,
    }
  } catch (error: any) {
    console.error('[assistant] ❌ Error generating response:', error)
    throw new Error(`Assistant error: ${error.message}`)
  }
}

/**
 * Build system prompt based on current conversation step
 */
function buildSystemPrompt(state: ConversationState): string {
  const basePersonality = `You are Mr. Imagine, the friendly purple furry mascot of ImagineThisPrinted.
You're a cute, fluffy purple character who LOVES helping people create custom designs!

Your personality:
- Enthusiastic and encouraging, genuinely excited about design ideas
- Uses casual, fun language ("Yo!", "That's fire!", "Let's gooo!", "Nice!")
- Gets hyped about creative ideas - designing is your PASSION
- Signs off with: "If you can imagine it, we can print it!"

CRITICAL RULES:
- NEVER mention having a mustache - you don't have one, you're a fluffy purple character
- NEVER say "As an AI..." - you're Mr. Imagine, a real mascot character
- NEVER redirect to other services - YOU are the design service
- Keep responses VERY SHORT - MAX 1-2 sentences! User CANNOT interrupt you!

Your job: Help users describe what they want, then create it for them.`

  const stepInstructions = getStepInstructions(state)

  return `${basePersonality}

${stepInstructions}

Current conversation stage: ${state.step}
Data collected so far: ${JSON.stringify(state.collectedData)}

Remember: Focus on helping them describe their DESIGN vision. Don't ask about shirt colors or product types until they've finalized their design!`
}

/**
 * Get specific instructions based on current step
 */
function getStepInstructions(state: ConversationState): string {
  switch (state.step) {
    case 'greeting':
      return `You just met the user! Welcome them warmly and ask what kind of design they're dreaming about today.
Example: "Yo! I'm Mr. Imagine - the guy with the best mustache in custom printing! Ready to make something awesome together? What's on your mind?"`

    case 'exploring':
      return `You're gathering design info. Keep it QUICK and DIRECT!
- If they've given you a clear idea (subject + style or colors), immediately offer to create it!
- Say something like "Love it! Want me to whip up some designs for you?"
- Don't ask too many questions - 1-2 max before offering to generate
- Be enthusiastic and ready to CREATE, not interrogate!`

    case 'refining':
      return `The user has shared their vision. Help them refine it!
- Repeat back what you've understood
- Ask clarifying questions if needed
- Make sure you understand: What's the main subject? What style? What colors? Any text?
- When ready, offer to summarize the final design concept`

    case 'confirm_design':
      return `Summarize the design concept and ask for confirmation BEFORE generating.
- Give a clear, detailed summary of what you'll create
- Ask "Should I create 3 design options based on this?" or similar
- If they say yes, indicate you're ready to generate
- If they want changes, go back to refining`

    case 'select_design':
      return `The designs have been generated! Help the user choose their favorite.
- The designs are displayed in the UI
- Ask which one they like best (1, 2, or 3)
- Be excited about their choice!`

    case 'garment_options':
      return `NOW it's time to ask about the garment! The design is chosen, now we customize the product.
Ask ONE question at a time about:
1. Product type: t-shirt, hoodie, or tank top?
2. Shirt color: black, white, or gray? (remind them colors affect how the design looks)
3. Placement: center chest, left pocket area, or back?

Be helpful explaining how shirt color affects the design visibility.`

    case 'final_confirm':
      return `Everything is set! Give a final summary:
- The design they chose
- The product type, color, and placement
Ask if they're ready to add it to their cart!`

    case 'complete':
      return `Celebrate! They're done. Congratulate them on their awesome custom design!`

    default:
      return `Continue the natural conversation about their design vision.`
  }
}

/**
 * Check if user message contains a complete design request that can generate immediately
 */
function isCompleteDesignRequest(message: string): boolean {
  const lowerMessage = message.toLowerCase()

  // Check for explicit generation requests
  const hasGenerateKeyword = lowerMessage.match(/create|make|design|draw|generate|give me|i want|i need|can you make/)

  // Check for enough descriptive content (subject + at least one modifier)
  const hasSubject = lowerMessage.match(/dragon|skull|flower|rose|heart|cat|dog|wolf|lion|eagle|butterfly|sun|moon|star|tree|mountain|car|guitar|gaming|anime|skull|fire|flames|ocean|beach|city|forest|sports|basketball|football|soccer|music|peace|love|crown|wings|snake|tiger|bear|phoenix|sword|robot|alien|space|planet|graffiti/)

  const hasStyle = lowerMessage.match(/cool|dope|sick|fire|epic|minimal|bold|colorful|black and white|neon|vintage|retro|cartoon|realistic|artistic|abstract|tribal|gothic|cute|scary|funny/)

  const hasColor = lowerMessage.match(/red|blue|green|yellow|purple|orange|pink|black|white|gold|silver|rainbow|neon|pastel/)

  // Direct request + descriptive enough = ready to generate
  const descriptiveEnough = (hasSubject && (hasStyle || hasColor)) || message.length > 50

  return !!(hasGenerateKeyword && descriptiveEnough)
}

/**
 * Analyze conversation and update state
 */
function analyzeAndUpdateState(
  state: ConversationState,
  userMessage: string,
  aiResponse: string
): { readyToGenerate: boolean; garmentReady: boolean } {
  const lowerMessage = userMessage.toLowerCase()
  const lowerResponse = aiResponse.toLowerCase()

  let readyToGenerate = false
  let garmentReady = false

  // FAST PATH: Check if this is a complete, actionable design request
  // If so, skip the multi-step flow and generate immediately
  if ((state.step === 'greeting' || state.step === 'exploring') && isCompleteDesignRequest(userMessage)) {
    console.log('[assistant] 🚀 FAST PATH: Complete design request detected, generating immediately!')
    state.collectedData.designConcept = userMessage
    finalizeDesignConcept(state)
    state.step = 'generating'
    readyToGenerate = true
    return { readyToGenerate, garmentReady }
  }

  switch (state.step) {
    case 'greeting':
      // Move to exploring once they describe anything about a design
      if (lowerMessage.length > 10) {
        state.step = 'exploring'
        // Start building the design concept
        state.collectedData.designConcept = userMessage

        // If the message is descriptive enough, offer to generate
        if (lowerMessage.length > 30) {
          // AI should ask if they want to generate
          state.step = 'confirm_design'
        }
      }
      break

    case 'exploring':
      // Accumulate design information
      updateDesignConcept(state, userMessage)

      // More aggressive - if we have a decent description, move to confirm faster
      if (state.collectedData.designConcept && state.collectedData.designConcept.length > 40) {
        state.step = 'confirm_design'
      } else if (lowerResponse.includes('so you want') ||
          lowerResponse.includes('let me make sure') ||
          lowerResponse.includes('sounds like you')) {
        state.step = 'confirm_design'
      }
      break

    case 'refining':
      updateDesignConcept(state, userMessage)
      // Move to confirm more quickly
      state.step = 'confirm_design'
      break

    case 'confirm_design':
      // Check for positive confirmation - be more permissive
      if (lowerMessage.match(/yes|yeah|yep|sure|ok|okay|let's|go|do it|sounds good|perfect|please|create|make|generate/)) {
        state.step = 'generating'
        readyToGenerate = true
        // Finalize the design concept
        finalizeDesignConcept(state)
      } else if (lowerMessage.match(/no|change|different|actually|wait|hold/)) {
        state.step = 'refining'
      } else {
        // If they add more details, treat it as refinement then confirm
        updateDesignConcept(state, userMessage)
        // Stay in confirm but with updated concept
      }
      break

    case 'generating':
      // This state is handled externally - designs are being generated
      // Frontend will call back when done and move to select_design
      break

    case 'select_design':
      // Check for selection
      if (lowerMessage.match(/1|first|one|left/)) {
        state.collectedData.selectedDesignIndex = 0
        state.step = 'garment_options'
      } else if (lowerMessage.match(/2|second|two|middle|center/)) {
        state.collectedData.selectedDesignIndex = 1
        state.step = 'garment_options'
      } else if (lowerMessage.match(/3|third|three|right|last/)) {
        state.collectedData.selectedDesignIndex = 2
        state.step = 'garment_options'
      }
      break

    case 'garment_options':
      // Parse garment preferences
      if (!state.collectedData.productType) {
        if (lowerMessage.match(/hoodie/)) {
          state.collectedData.productType = 'hoodie'
        } else if (lowerMessage.match(/tank/)) {
          state.collectedData.productType = 'tank'
        } else if (lowerMessage.match(/shirt|tee|t-shirt/)) {
          state.collectedData.productType = 'tshirt'
        }
      }

      if (!state.collectedData.shirtColor) {
        if (lowerMessage.match(/black/)) {
          state.collectedData.shirtColor = 'black'
        } else if (lowerMessage.match(/white/)) {
          state.collectedData.shirtColor = 'white'
        } else if (lowerMessage.match(/gray|grey/)) {
          state.collectedData.shirtColor = 'gray'
        }
      }

      if (!state.collectedData.printPlacement) {
        if (lowerMessage.match(/pocket|small|left/)) {
          state.collectedData.printPlacement = 'left-pocket'
        } else if (lowerMessage.match(/back/)) {
          state.collectedData.printPlacement = 'back-only'
        } else if (lowerMessage.match(/center|front|chest/)) {
          state.collectedData.printPlacement = 'front-center'
        }
      }

      // Check if all garment options are collected
      if (state.collectedData.productType &&
          state.collectedData.shirtColor &&
          state.collectedData.printPlacement) {
        state.step = 'final_confirm'
        garmentReady = true
      }
      break

    case 'final_confirm':
      if (lowerMessage.match(/yes|yeah|yep|sure|ok|okay|perfect|add|cart/)) {
        state.step = 'complete'
        garmentReady = true
      }
      break
  }

  return { readyToGenerate, garmentReady }
}

/**
 * Update design concept with new information from user
 */
function updateDesignConcept(state: ConversationState, userMessage: string): void {
  const lowerMessage = userMessage.toLowerCase()

  // Extract image style (photorealistic vs cartoon) - IMPORTANT FOR FRONTEND FORM
  if (lowerMessage.match(/photo.?realistic|realistic|real|photo|photograph/)) {
    state.collectedData.imageStyle = 'realistic'
  } else if (lowerMessage.match(/cartoon|animated|illustration|illustrated|artistic|art|stylized|anime|drawn/)) {
    state.collectedData.imageStyle = 'cartoon'
  }

  // Extract style keywords
  if (lowerMessage.match(/street|urban|hip.?hop|graffiti/)) {
    state.collectedData.style = 'streetwear'
  } else if (lowerMessage.match(/minimal|simple|clean/)) {
    state.collectedData.style = 'minimal'
  } else if (lowerMessage.match(/vintage|retro|classic|old.?school/)) {
    state.collectedData.style = 'vintage'
  } else if (lowerMessage.match(/bold|graphic|vibrant|loud/)) {
    state.collectedData.style = 'bold graphics'
  } else if (lowerMessage.match(/cute|kawaii|adorable/)) {
    state.collectedData.style = 'cute/kawaii'
  } else if (lowerMessage.match(/dark|gothic|metal/)) {
    state.collectedData.style = 'dark/gothic'
  }

  // Extract color keywords
  const colorPatterns = ['black', 'white', 'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'grey', 'gray', 'neon', 'pastel', 'vibrant', 'muted']
  colorPatterns.forEach((color) => {
    if (lowerMessage.includes(color)) {
      if (!state.collectedData.colors) {
        state.collectedData.colors = []
      }
      if (!state.collectedData.colors.includes(color)) {
        state.collectedData.colors.push(color)
      }
    }
  })

  // Append to design concept
  if (state.collectedData.designConcept) {
    state.collectedData.designConcept += ' ' + userMessage
  } else {
    state.collectedData.designConcept = userMessage
  }
}

/**
 * Finalize design concept for generation
 */
function finalizeDesignConcept(state: ConversationState): void {
  // Build a clean, comprehensive design prompt from collected data
  let concept = state.collectedData.designConcept || ''

  if (state.collectedData.style && !concept.includes(state.collectedData.style)) {
    concept = `${state.collectedData.style} style: ${concept}`
  }

  if (state.collectedData.colors && state.collectedData.colors.length > 0) {
    const colorStr = state.collectedData.colors.join(', ')
    if (!concept.toLowerCase().includes(colorStr.toLowerCase())) {
      concept += ` Using ${colorStr} colors.`
    }
  }

  if (state.collectedData.text) {
    concept += ` Include text: "${state.collectedData.text}"`
  }

  state.collectedData.designConcept = concept.trim()
  console.log('[assistant] 📝 Finalized design concept:', state.collectedData.designConcept)
}

/**
 * Generate the next guiding prompt based on current state
 */
function generateNextPrompt(state: ConversationState): string {
  switch (state.step) {
    case 'greeting':
      return 'What would you like to design today?'
    case 'exploring':
      return 'Tell me more about your vision!'
    case 'refining':
      return 'Anything else you want to add or change?'
    case 'confirm_design':
      return 'Ready to see some design options?'
    case 'generating':
      return 'Creating your designs...'
    case 'select_design':
      return 'Which design do you like best?'
    case 'garment_options':
      if (!state.collectedData.productType) {
        return 'T-shirt, hoodie, or tank top?'
      }
      if (!state.collectedData.shirtColor) {
        return 'Black, white, or gray?'
      }
      if (!state.collectedData.printPlacement) {
        return 'Center chest, pocket area, or back?'
      }
      return 'Let me know your preferences!'
    case 'final_confirm':
      return 'Ready to add to cart?'
    case 'complete':
      return 'Enjoy your custom creation!'
    default:
      return 'How can I help you?'
  }
}

/**
 * Reset conversation for a user (start over)
 */
export function resetConversation(userId: string): void {
  conversations.delete(userId)
  console.log('[assistant] 🔄 Conversation reset for user:', userId)
}

/**
 * Get current design data for generation
 */
export function getDesignData(userId: string): ConversationState['collectedData'] {
  const state = getConversationState(userId)
  return state.collectedData
}

/**
 * Set generated designs after multi-model generation completes
 */
export function setGeneratedDesigns(
  userId: string,
  designs: Array<{ modelId: string; modelName: string; imageUrl?: string; status: string }>
): void {
  const state = getConversationState(userId)
  state.collectedData.generatedDesigns = designs
  state.step = 'select_design'
  console.log('[assistant] 🖼️ Designs set for user:', userId, designs.length, 'designs')
}

/**
 * Get conversation step for external state management
 */
export function getConversationStep(userId: string): ConversationState['step'] {
  const state = getConversationState(userId)
  return state.step
}

/**
 * Set conversation step (for external triggers)
 */
export function setConversationStep(userId: string, step: ConversationState['step']): void {
  const state = getConversationState(userId)
  state.step = step
  console.log('[assistant] 📍 Step set for user:', userId, step)
}
