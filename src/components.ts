// The site that renders the components.
export const origin = import.meta.env.VITE_PREVIEW_ORIGIN ?? 'https://localhost:3000'

// What to show in one frame.
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

// One entry per choice, so the variants sit side by side. Name the template:
// that applies its tag and the defaults for its other settings, as the CMS does.
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

// Stands in for the list the CMS holds after `config push`, so it is kept in
// step by hand the same way. These are the elements an editor can place.
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
