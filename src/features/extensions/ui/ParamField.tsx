import { type ReactNode } from "react"
import { type ParamSpec } from "@open20/battlemaps-sdk"
import { SliderControl } from "../../tools/controls/SliderControl"
import { SwitchParamControl } from "../../tools/controls/SwitchParamControl"
import { CustomColorControl } from "../../tools/controls/CustomColorControl"
import { SegmentedParamControl } from "../../tools/controls/SegmentedParamControl"
import { RangeSliderControl } from "../../tools/controls/RangeSliderControl"
import { LayerControl } from "../../tools/controls/LayerControl"
import { TextParamControl } from "../../tools/controls/TextParamControl"
import { NumberParamControl } from "../../tools/controls/NumberParamControl"
import { type ToolParamSpec } from "../../tools/params"
import { toParamSpec } from "../tools"

type FormKind =
  "switch" | "slider" | "range" | "segmented" | "customColor" | "layer" | "text" | "number"
type SpecOf<K extends FormKind> = Extract<ToolParamSpec, { kind: K }>
interface FieldArgs<K extends FormKind> {
  s: SpecOf<K>
  value: unknown
  onChange: (value: unknown) => void
}

const numOr = (v: unknown, f: number) => (typeof v === "number" ? v : f)
const strOr = (v: unknown, f: string) => (typeof v === "string" ? v : f)

/** The control of each kind a form can show (the same ones tools use). */
const FIELDS: { [K in FormKind]: (a: FieldArgs<K>) => ReactNode } = {
  switch: ({ s, value, onChange }) => (
    <SwitchParamControl
      value={value === true}
      labelKey={s.labelKey}
      tooltipKey={s.tooltipKey}
      onChange={onChange}
    />
  ),
  slider: ({ s, value, onChange }) => (
    <SliderControl
      value={numOr(value, s.default)}
      labelKey={s.labelKey}
      min={s.min}
      max={s.max}
      step={s.step}
      onChange={onChange}
    />
  ),
  range: ({ s, value, onChange }) => (
    <RangeSliderControl
      value={Array.isArray(value) ? (value as [number, number]) : s.default}
      labelKey={s.labelKey}
      min={s.min}
      max={s.max}
      step={s.step}
      onChange={onChange}
    />
  ),
  segmented: ({ s, value, onChange }) => (
    <SegmentedParamControl
      value={strOr(value, s.default)}
      labelKey={s.labelKey}
      options={s.options}
      onChange={onChange}
    />
  ),
  customColor: ({ s, value, onChange }) => (
    <CustomColorControl
      value={strOr(value, s.default)}
      labelKey={s.labelKey}
      presets={s.presets}
      onChange={onChange}
    />
  ),
  layer: ({ s, value, onChange }) => (
    <LayerControl value={numOr(value, s.default)} allowed={s.allowed} onChange={onChange} />
  ),
  text: ({ s, value, onChange }) => (
    <TextParamControl
      value={strOr(value, s.default)}
      labelKey={s.labelKey}
      maxLength={s.maxLength}
      onChange={onChange}
    />
  ),
  number: ({ s, value, onChange }) => (
    <NumberParamControl
      value={numOr(value, s.default)}
      labelKey={s.labelKey}
      min={s.min}
      max={s.max}
      onChange={onChange}
    />
  ),
}

/**
 * One field of an extension's form (generator params, export options, panel
 * fields), drawn with the same controls as the tools' params. Kinds that
 * only make sense in a tool (asset, font, button) aren't offered in forms.
 */
export function ParamField({
  extId,
  spec,
  value,
  onChange,
}: {
  extId: string
  spec: ParamSpec
  value: unknown
  onChange: (value: unknown) => void
}) {
  const s = toParamSpec(extId, spec)
  if (!s || !(s.kind in FIELDS)) return null
  const field = FIELDS[s.kind as FormKind] as (a: FieldArgs<FormKind>) => ReactNode
  return field({ s: s as SpecOf<FormKind>, value, onChange })
}
