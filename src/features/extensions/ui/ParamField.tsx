import { type ParamSpec } from "@open20/battlemaps-sdk"
import { SliderControl } from "../../tools/controls/SliderControl"
import { SwitchParamControl } from "../../tools/controls/SwitchParamControl"
import { CustomColorControl } from "../../tools/controls/CustomColorControl"
import { SegmentedParamControl } from "../../tools/controls/SegmentedParamControl"
import { RangeSliderControl } from "../../tools/controls/RangeSliderControl"
import { LayerControl } from "../../tools/controls/LayerControl"
import { TextParamControl } from "../../tools/controls/TextParamControl"
import { NumberParamControl } from "../../tools/controls/NumberParamControl"
import { toParamSpec } from "../tools"

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
  if (!s) return null
  switch (s.kind) {
    case "switch":
      return (
        <SwitchParamControl
          value={value === true}
          labelKey={s.labelKey}
          tooltipKey={s.tooltipKey}
          onChange={onChange}
        />
      )
    case "slider":
      return (
        <SliderControl
          value={typeof value === "number" ? value : s.default}
          labelKey={s.labelKey}
          min={s.min}
          max={s.max}
          step={s.step}
          onChange={onChange}
        />
      )
    case "range":
      return (
        <RangeSliderControl
          value={Array.isArray(value) ? (value as [number, number]) : s.default}
          labelKey={s.labelKey}
          min={s.min}
          max={s.max}
          step={s.step}
          onChange={onChange}
        />
      )
    case "segmented":
      return (
        <SegmentedParamControl
          value={typeof value === "string" ? value : s.default}
          labelKey={s.labelKey}
          options={s.options}
          onChange={onChange}
        />
      )
    case "customColor":
      return (
        <CustomColorControl
          value={typeof value === "string" ? value : s.default}
          labelKey={s.labelKey}
          presets={s.presets}
          onChange={onChange}
        />
      )
    case "layer":
      return (
        <LayerControl
          value={typeof value === "number" ? value : s.default}
          allowed={s.allowed}
          onChange={onChange}
        />
      )
    case "text":
      return (
        <TextParamControl
          value={typeof value === "string" ? value : s.default}
          labelKey={s.labelKey}
          maxLength={s.maxLength}
          onChange={onChange}
        />
      )
    case "number":
      return (
        <NumberParamControl
          value={typeof value === "number" ? value : s.default}
          labelKey={s.labelKey}
          min={s.min}
          max={s.max}
          onChange={onChange}
        />
      )
    default:
      return null
  }
}
