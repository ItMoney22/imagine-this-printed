// Pet ornament — what the image model is asked to draw (task 81358f3a).
//
// The model's picture is not shown to the customer as-is: it is cut into at
// most four flat colours (quantize.ts) and each colour becomes a raised layer
// of the print. So the prompt asks for what survives that: big flat shapes,
// one thick black ink for every line, a plain white ground, nothing thinner
// than a line a 0.4 mm nozzle can lay down at ornament size.
//
// No customer text ever reaches this prompt — only the pet word, which comes
// from the template's own list, never from the request.

export function portraitFromPhotoPrompt(pet: string): string {
  return [
    `Redraw the ${pet} in this photo as a simple flat-colour cartoon portrait, like a sticker or enamel pin, for a small printed ornament.`,
    `Head and upper chest only, facing the viewer, centred, filling most of the square. Keep THIS ${pet}'s real coat colours, markings, ear shape and eye colour so its owner recognises it.`,
    'Rules for the colours: a pure white background; one thick, solid black outline around the whole animal and around the eyes, nose, mouth and inner ears; inside the outline use no more than two flat fur colours plus black. No gradients, no shading, no highlights, no fur texture, no thin whiskers, no small specks.',
    'Lines must be bold and even. No text, no letters, no collar tag, no frame, no background objects.',
  ].join(' ')
}

/** The stock design for a pet type when no photo is given: same rules, a friendly generic animal. */
export function stockPortraitPrompt(pet: string, coat: string): string {
  return [
    `A simple, cute, flat-colour cartoon portrait of a ${coat} ${pet}, like a sticker or enamel pin, for a small printed ornament.`,
    'Head and upper chest only, facing the viewer, centred, filling most of the square, happy friendly expression.',
    'Rules for the colours: a pure white background; one thick, solid black outline around the whole animal and around the eyes, nose, mouth and inner ears; inside the outline use no more than two flat fur colours plus black. No gradients, no shading, no highlights, no fur texture, no thin whiskers, no small specks.',
    'Lines must be bold and even. No text, no letters, no collar tag, no frame, no background objects.',
  ].join(' ')
}
