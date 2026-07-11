import { useTranslation } from "react-i18next"
import { type SegmentedChoice } from "../params"
import { SegmentedControl } from "./SegmentedControl"

/** A data-driven `segmented` param: translates its choices and renders them. */
export function SegmentedParamControl({
  value,
  labelKey,
  options,
  onChange,
}: {
  value: string
  labelKey: string
  options: SegmentedChoice[]
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      label={t(labelKey)}
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o.value, label: t(o.labelKey), icon: o.icon }))}
    />
  )
}
