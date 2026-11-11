import type { ReactNode } from "react"
import { useEditorStore } from "../../../stores/editorStore"
import { useMapStore } from "../../../stores/mapStore"
import { useToolsStore } from "../../../stores/toolsStore"
import { LevelsPanel } from "../../map/LevelsPanel"
import { isToolActionDisabled, notifyParamsChange, runToolAction } from "../behaviors"
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
import { PrefabsControl } from "./PrefabsControl"
import { ACTION_BY_ID } from "../../shortcuts/actions"
import { useActionBinding } from "../../shortcuts/bindings"
import { SelectionPropertiesControl } from "./SelectionPropertiesControl"
import { IconTogglesControl } from "./IconTogglesControl"

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
  biome: ({ toolId, spec, value, onChange }) => (
    <BiomeControl
      value={value}
      labelKey={spec.labelKey}
      onChange={onChange}
      onFill={() => runToolAction(toolId, "fill")}
    />
  ),
  button: ({ toolId, spec }) => <ActionButton toolId={toolId} spec={spec} />,
  font: ({ spec, value, onChange }) => (
    <FontControl value={value} labelKey={spec.labelKey} onChange={onChange} />
  ),
  levels: () => <LevelsPanel />,
  prefabs: ({ spec, value, onChange }) => (
    <PrefabsControl value={value} labelKey={spec.labelKey} onChange={onChange} />
  ),
  iconToggles: ({ spec, value, onChange }) => (
    <IconTogglesControl
      value={value}
      labelKey={spec.labelKey}
      options={spec.options}
      defaultValue={spec.default}
      onChange={onChange}
    />
  ),
  // Each property reuses its kind's control, so it's rendered through here too.
  properties: ({ toolId }) => (
    <SelectionPropertiesControl
      renderControl={(spec, value, onChange) =>
        renderParam({
          toolId,
          spec,
          value: value as ParamValueByKind[ParamKind],
          values: {},
          onChange,
        })
      }
    />
  ),
}

/**
 * A button param bound to its tool's action. Whether it's enabled usually
 * depends on the document/selection (e.g. Delete needs a selected text), so
 * it re-evaluates whenever those change.
 */
function ActionButton({
  toolId,
  spec,
}: {
  toolId: string
  spec: Extract<ToolParamSpec, { kind: "button" }>
}) {
  useEditorStore((s) => s.selection)
  useMapStore((s) => s.map)
  const disabled = spec.disabled || isToolActionDisabled(toolId, spec.paramKey)
  // A button whose action is also a shortcut shows its current binding.
  const binding = useActionBinding(spec.paramKey)
  return (
    <ButtonControl
      binding={ACTION_BY_ID.has(spec.paramKey) ? binding : undefined}
      labelKey={spec.labelKey}
      icon={spec.icon}
      colorPalette={spec.colorPalette}
      disabled={disabled}
      onClick={() => runToolAction(toolId, spec.paramKey)}
    />
  )
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
  const onChange = (value: unknown) => {
    const patch = { [spec.paramKey]: value }
    setToolParams(toolId, patch)
    notifyParamsChange(toolId, patch)
  }
  return renderParam({
    toolId,
    spec,
    value: values[spec.paramKey] as ParamValueByKind[ParamKind],
    values,
    onChange,
  })
}
