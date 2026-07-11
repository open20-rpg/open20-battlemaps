import { LuArrowDown, LuArrowUp } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { type Sorting } from "../params"
import { SegmentedControl } from "./SegmentedControl"

/**
 * Sorting selector: within a layer, place new items on top ("Over") or at the
 * bottom ("Under"). A two-option {@link SegmentedControl}.
 */
export function SortingControl({
  value,
  onChange,
}: {
  value: Sorting
  onChange: (value: Sorting) => void
}) {
  const { t } = useTranslation()
  return (
    <SegmentedControl<Sorting>
      label={t("tools.sorting")}
      value={value}
      onChange={onChange}
      options={[
        { value: "over", label: t("tools.sortingOver"), icon: LuArrowUp },
        { value: "under", label: t("tools.sortingUnder"), icon: LuArrowDown },
      ]}
    />
  )
}
