import { useToolsStore } from "../../../stores/toolsStore"
import { getParam, type ToolParamSpec, type ToolParamValues } from "../params"
import { CustomColorControl } from "./CustomColorControl"
import { LayerControl } from "./LayerControl"
import { SortingControl } from "./SortingControl"
import { SwitchParamControl } from "./SwitchParamControl"
import { ShapeControl } from "./ShapeControl"
import { EditPointsControl } from "./EditPointsControl"
import { ToggleTextControl } from "./ToggleTextControl"
import { SliderControl } from "./SliderControl"
import { AssetPickerControl } from "./AssetPickerControl"

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

  switch (spec.kind) {
    case "customColor":
      return <CustomColorControl value={getParam(values, spec)} onChange={onChange} />
    case "layer":
      return <LayerControl value={getParam(values, spec)} allowed={spec.allowed} onChange={onChange} />
    case "sorting":
      return <SortingControl value={getParam(values, spec)} onChange={onChange} />
    case "switch":
      return (
        <SwitchParamControl
          value={getParam(values, spec)}
          labelKey={spec.labelKey}
          onChange={onChange}
        />
      )
    case "toggleText":
      return (
        <ToggleTextControl
          value={getParam(values, spec)}
          trueLabelKey={spec.trueLabelKey}
          falseLabelKey={spec.falseLabelKey}
          icon={spec.icon}
          onChange={onChange}
        />
      )
    case "slider":
      return (
        <SliderControl
          value={getParam(values, spec)}
          labelKey={spec.labelKey}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={onChange}
        />
      )
    case "shape":
      return (
        <ShapeControl
          value={getParam(values, spec)}
          allowBrush={spec.allowBrush}
          onChange={onChange}
        />
      )
    case "brushSize":
      return (
        <SliderControl
          value={getParam(values, spec)}
          labelKey="tools.brushSize"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={onChange}
        />
      )
    case "editPoints":
      return <EditPointsControl value={getParam(values, spec)} onChange={onChange} />
    case "assetPicker":
      return (
        <AssetPickerControl
          value={getParam(values, spec)}
          browserKey={`param:${toolId}:${spec.paramKey}`}
          labelKey={spec.labelKey}
          category={spec.category}
          select={spec.select}
          allowNull={spec.allowNull}
          onChange={onChange}
        />
      )
  }
}
