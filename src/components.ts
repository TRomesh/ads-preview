// The site that renders the components.
export const origin = import.meta.env.VITE_PREVIEW_ORIGIN ?? 'https://localhost:3000'

// One tile: which component, and optionally which display template and
// settings to render it with.
export type Selection = {
  /** Content type key, as the site registers it. */
  contentType: string
  /** Display template key. Omit for the component's default. */
  displayTemplate?: string
  /** Display settings to pin, e.g. `{ variant: 'primary' }`. */
  settings?: Record<string, string>
}

export function previewUrl({ contentType, displayTemplate, settings }: Selection) {
  const params = new URLSearchParams({ contentType, ...settings })
  if (displayTemplate) params.set('displayTemplate', displayTemplate)

  return `${origin}/preview/component?${params}`
}

// One entry per choice, so a component's variants sit side by side.
//
// Name the display template, not just the setting: that applies the
// template's tag and the defaults for its other settings, which is what the
// CMS does. A bare setting on its own only overrides that one value.
function variants(
  base: Selection,
  setting: string,
  values: string[],
): Selection[] {
  return values.map(value => ({
    ...base,
    settings: { ...base.settings, [setting]: value },
  }))
}

// What to show. Stands in for the list the CMS already holds after
// `config push`, and is kept in step by hand the same way.
//
// These keys are from the Stride template. For Alloy, use: Teaser, Notice,
// Button, Editorial, Article, Contact, NewsEventsList — with the
// TeaserDisplayTemplate (orientation) and NoticeDisplayTemplate (color).

export const components: Selection[] = [
  { contentType: 'HeadingElement' },
  { contentType: 'RichTextElement' },

  // Two settings, so each is varied against the other's default.
  ...variants(
    { contentType: 'HeadingElement', displayTemplate: 'HeadingStyles' },
    'level',
    ['default', 'h2', 'h3', 'h4', 'h5'],
  ),
  ...variants(
    { contentType: 'HeadingElement', displayTemplate: 'HeadingStyles' },
    'icon',
    ['check', 'globe', 'sparkles', 'wallet'],
  ),

  ...variants(
    { contentType: 'ButtonElement', displayTemplate: 'ButtonStyles' },
    'variant',
    ['default', 'primary', 'outline'],
  ),

  { contentType: 'ImageElement' },
  { contentType: 'ImageCardElement' },
  { contentType: 'VideoElement' },
  { contentType: 'HorizontalRulerElement' },
  { contentType: 'OptiFormsTextboxElement' },
  { contentType: 'OptiFormsTextareaElement' },
  { contentType: 'OptiFormsNumberElement' },
  { contentType: 'OptiFormsRangeElement' },
  { contentType: 'OptiFormsUrlElement' },
  { contentType: 'OptiFormsChoiceElement' },
  { contentType: 'OptiFormsSelectionElement' },
  { contentType: 'OptiFormsSubmitElement' },
  { contentType: 'OptiFormsResetElement' },
]

