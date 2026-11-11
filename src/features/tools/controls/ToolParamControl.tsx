import type { ReactNode } from "react"
import { useToolsStore } from "../../../stores/toolsStore"
import {
  type ParamKind,
  type ParamValueByKind,
  type ToolParamSpec,
  type ToolParamValues,
} from "../params"
import { CustomColorControl } from "./CustomColorControl"
import { LayerControl } from "./LayerControl"
import { SortingControl } from "./SortingControl"
import { SegmentedParamControl } from "./SegmentedParamControl"
import { RangeSliderControl } from "./RangeSliderControl"
import { SwitchParamControl } from "./SwitchParamControl"
import { ShapeControl } from "./ShapeControl"
import { EditPointsControl } from "./EditPointsControl"
import { SliderControl } from "./SliderControl"
import { AssetPickerControl } from "./AssetPickerControl"
import { BiomeControl } from "./biome/BiomeControl"
import { ButtonControl } from "./ButtonControl"
import { FontControl } from "./FontControl"

interface RenderArgs<K extends ParamKind> {
  toolId: string
  spec: Extract<ToolParamSpec, { kind: K }>
  value: ParamValueByKind[K]
  values: ToolParamValues
  onChange: (value: unknown) => void
}

/**
 * One renderer per param kind. A mapped type (not a `switch`) so that adding a
 * kind to `ParamValueByKind` without its control is a compile error, while each
 * entry stays a flat, independently readable branch.
 */
const RENDERERS: { [K in ParamKind]: (args: RenderArgs<K>) => ReactNode } = {
  customColor: ({ spec, value, onChange }) => (
    <CustomColorControl
      value={value}
      labelKey={spec.labelKey}
      presets={spec.presets}
      onChange={onChange}
    />
  ),
  layer: ({ spec, value, onChange }) => (
    <LayerControl value={value} allowed={spec.allowed} onChange={onChange} />
  ),
  sorting: ({ value, onChange }) => <SortingControl value={value} onChange={onChange} />,
  segmented: ({ spec, value, onChange }) => (
    <SegmentedParamControl
      value={value}
      labelKey={spec.labelKey}
      options={spec.options}
      onChange={onChange}
    />
  ),
  switch: ({ spec, value, onChange }) => (
    <SwitchParamControl value={value} labelKey={spec.labelKey} onChange={onChange} />
  ),
  slider: ({ spec, value, onChange }) => (
    <SliderControl
      value={value}
      labelKey={spec.labelKey}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      onChange={onChange}
    />
  ),
  shape: ({ spec, value, onChange }) => (
    <ShapeControl value={value} allowBrush={spec.allowBrush} onChange={onChange} />
  ),
  range: ({ spec, value, onChange }) => (
    <RangeSliderControl
      value={value}
      labelKey={spec.labelKey}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      onChange={onChange}
    />
  ),
  brushSize: ({ spec, value, onChange }) => (
    <SliderControl
      value={value}
      labelKey="tools.brushSize"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      onChange={onChange}
    />
  ),
  editPoints: ({ spec, value, onChange }) => (
    <EditPointsControl value={value} labelKey={spec.labelKey} onChange={onChange} />
  ),
  assetPicker: ({ toolId, spec, value, values, onChange }) => {
    const recolor = spec.recolor ?? "own"
    const recolorColor =
      typeof recolor === "object" ? (values[recolor.fromParam] as string) : undefined
    return (
      <AssetPickerControl
        value={value}
        browserKey={`param:${toolId}:${spec.paramKey}`}
        labelKey={spec.labelKey}
        category={spec.category}
        select={spec.select}
        allowNull={spec.allowNull}
        showColorSwatch={recolor === "own"}
        recolorColor={recolorColor}
        onChange={onChange}
      />
    )
  },
  biome: ({ spec, value, onChange }) => (
    <BiomeControl value={value} labelKey={spec.labelKey} onChange={onChange} />
  ),
  button: ({ spec }) => (
    <ButtonControl
      labelKey={spec.labelKey}
      icon={spec.icon}
      colorPalette={spec.colorPalette}
      disabled={spec.disabled}
    />
  ),
  font: ({ spec, value, onChange }) => (
    <FontControl value={value} labelKey={spec.labelKey} onChange={onChange} />
  ),
}

// TS can't correlate `spec.kind` with the renderer picked by it (the union
// isn't distributed over the lookup), so the pairing is asserted once here.
function renderParam<K extends ParamKind>(args: RenderArgs<K>): ReactNode {
  return (RENDERERS[args.spec.kind] as (a: RenderArgs<K>) => ReactNode)(args)
}

/**
 * The single wiring point between param specs and the tools store: resolves
 * the spec's current value out of the (already materialized) param bag and
 * renders the matching presentational control. Controls know nothing about
 * tools or the store — they get `value` + `onChange`.
 */
export function ToolParamControl({
  toolId,
  spec,
  values,
}: {
  toolId: string
  spec: ToolParamSpec
  values: ToolParamValues
}) {
  const setToolParams = useToolsStore((s) => s.setToolParams)
  const onChange = (value: unknown) => setToolParams(toolId, { [spec.paramKey]: value })
  return renderParam({
    toolId,
    spec,
    value: values[spec.paramKey] as ParamValueByKind[ParamKind],
    values,
    onChange,
  })
}
