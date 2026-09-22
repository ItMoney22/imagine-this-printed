// Step Flow — the team-template panel inside the Mockups step.
//
// David 2026-09-21: "step flow needs to know this process of the team
// templates", and 2026-09-02: "we made a shirt for a football team we should
// be able to let the customer change name jersey number etc ... translate that
// to our Etsy store."
//
// WHY THIS IS NOT JUST A LINK. Until now this spot held a button that opened
// /admin/team-templates in another tab, so the one question the builder is
// actually asking — "will a customer's name look right on this shirt?" — could
// only be answered by leaving the flow. The panel below answers it in place:
// type a name, watch the real back plate redraw (the SAME render the press
// gets, at preview width), and see exactly what Etsy buyers will be told to
// type into their one free-text box.
//
// Everything here is read-only about the template itself. Authoring — zones,
// fonts, colours — stays on the admin screen, which is the right place for it;
// this is the proof step.
import React, { useState } from 'react'
import { ExternalLink, Shirt, Store } from 'lucide-react'
import TeamPersonalizePanel, { type TeamTemplateSummary } from '../TeamPersonalizePanel'
import {
  etsyPersonalizationCharMax,
  etsyPersonalizationInstructions,
} from '../../../backend/shared/personalization-etsy'
import { parseTeamTemplate } from '../../../backend/shared/team-template'

interface Props {
  productId: string
  /** The product row's `metadata`, straight off the Step Flow state. */
  productMetadata: any
  /** False for a front-only tee: there is no back plate to personalize. */
  hasBackPrint: boolean
}

const TeamTemplatePanel: React.FC<Props> = ({ productId, productMetadata, hasBackPrint }) => {
  // Sample values, local to this panel — nothing here is saved. The point is
  // to SEE a name on the shirt, so it starts pre-filled rather than empty.
  const [values, setValues] = useState<Record<string, string>>({})

  const template = parseTeamTemplate(productMetadata)
  const summary: TeamTemplateSummary | null = template
    ? { version: template.version, fields: template.fields, upcharge: template.upcharge }
    : null

  if (!hasBackPrint && !template) return null

  return (
    <div className="mb-4 rounded-xl border border-primary/30 bg-card p-3 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Shirt className="w-4 h-4 text-primary" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-semibold text-text">
            {template ? 'Personalizable — customers type their own name' : 'Two-sided shirt'}
          </p>
          <p className="text-xs text-muted">
            {template
              ? 'Try it below. This is the same drawing the press gets, and the same one Etsy buyers get.'
              : 'Set up a team template and customers can put their own name and number on the back.'}
          </p>
        </div>
        <a
          href={'/admin/team-templates/' + productId}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:opacity-90"
        >
          {template ? 'Edit template' : 'Set up team template'}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {template && summary && (
        <>
          <TeamPersonalizePanel
            productId={productId}
            template={summary}
            values={values}
            onChange={setValues}
            heading="What the customer sees"
            note="Type a test name — the back redraws as you type. Nothing here is saved."
          />

          {/* The Etsy side of the same template. A buyer there gets ONE
              free-text box and one line of instructions, so this is the whole
              of what they are told — worth reading before the listing goes up. */}
          <div className="rounded-xl border border-border bg-bg p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Store className="w-3.5 h-3.5 text-primary" />
              <p className="text-sm font-semibold text-text">On Etsy</p>
              <span className="ml-auto text-xs text-muted">
                {etsyPersonalizationCharMax(template)} character limit
              </span>
            </div>
            <p className="text-xs text-muted">
              Buyers get one box. They are told: “{etsyPersonalizationInstructions(template)}”
            </p>
            <p className="text-xs text-muted">
              Whatever they type is read back into the same fields and the press file is drawn the
              same way — a name typed as “SMITH 22” lands as {template.fields.map((f) => f.label).join(' + ')}.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default TeamTemplatePanel
