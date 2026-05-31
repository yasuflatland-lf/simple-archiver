import { AddSourceButtons } from "@/components/AddSourceButtons";
import { NamingRuleForm } from "@/components/NamingRuleForm";
import { OutputDirPicker } from "@/components/OutputDirPicker";
import { RunControls } from "@/components/RunControls";

/**
 * The setup zone (AppShell's `toolbar` slot): the mutable, pre-run controls —
 * add sources, naming template, output directory, and Run/Cancel. Lays out
 * horizontally and wraps on narrow windows so nothing is clipped.
 */
export function SetupToolbar() {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <AddSourceButtons />
      <div className="min-w-[200px] flex-1">
        <NamingRuleForm />
      </div>
      <div className="min-w-[180px]">
        <OutputDirPicker />
      </div>
      <RunControls />
    </div>
  );
}
