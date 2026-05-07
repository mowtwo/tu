// tu-xing showcase — every primitive at once.
import { Button, ButtonVariant, ButtonSize } from "@tu-lang/tu-xing/Button.tu"
import { Input, InputSize } from "@tu-lang/tu-xing/Input.tu"
import { Card } from "@tu-lang/tu-xing/Card.tu"
import { Badge, BadgeVariant } from "@tu-lang/tu-xing/Badge.tu"
import { Switch } from "@tu-lang/tu-xing/Switch.tu"
import { Dialog } from "@tu-lang/tu-xing/Dialog.tu"
import { Tabs } from "@tu-lang/tu-xing/Tabs.tu"

export let count = 0
export let dialogOpen = false
export let switchOn = false
export let activeTab = "buttons"
export let inputValue = ""

let setTab = (id: string) => activeTab = id
let toggleSwitch = (v: boolean) => switchOn = v
let openDialog = () => dialogOpen = true
let closeDialog = () => dialogOpen = false

let buttonsPanel = () => div(class: "space-y-3") {
  p(class: "text-sm text-[hsl(var(--tu-fg-muted))]") { "Variants × sizes:" }
  div(class: "flex flex-wrap gap-2") {
    Button(variant: ButtonVariant.Primary, size: ButtonSize.Sm) { "Primary sm" }
    Button(variant: ButtonVariant.Primary) { "Primary md" }
    Button(variant: ButtonVariant.Primary, size: ButtonSize.Lg) { "Primary lg" }
  }
  div(class: "flex flex-wrap gap-2") {
    Button(variant: ButtonVariant.Secondary) { "Secondary" }
    Button(variant: ButtonVariant.Ghost) { "Ghost" }
    Button(variant: ButtonVariant.Danger) { "Danger" }
    Button(variant: ButtonVariant.Primary, disabled: true) { "Disabled" }
  }
}

let inputsPanel = () => div(class: "space-y-3") {
  p(class: "text-sm text-[hsl(var(--tu-fg-muted))]") { "Sizes:" }
  Input(placeholder: "Small", size: InputSize.Sm)
  Input(placeholder: "Medium (default)")
  Input(placeholder: "Large", size: InputSize.Lg)
  Input(placeholder: "Disabled", disabled: true)
  div(class: "pt-2") {
    p(class: "text-sm text-[hsl(var(--tu-fg-muted))] mb-2") { "Live value:" }
    Input(placeholder: "type here", value: inputValue, onInput: (e: Event) => inputValue = (e.target as HTMLInputElement).value)
    p(class: "mt-2 text-sm text-[hsl(var(--tu-brand))]") { "you typed: " inputValue }
  }
}

let badgesPanel = () => div(class: "flex flex-wrap gap-2 items-center") {
  Badge { "Brand" }
  Badge(variant: BadgeVariant.Success) { "Success" }
  Badge(variant: BadgeVariant.Warning) { "Warning" }
  Badge(variant: BadgeVariant.Danger) { "Danger" }
  Badge(variant: BadgeVariant.Outline) { "Outline" }
}

let switchPanel = () => div(class: "flex items-center gap-3") {
  Switch(checked: switchOn, onChange: toggleSwitch)
  span(class: "text-sm text-[hsl(var(--tu-fg-muted))]") {
    if (switchOn) { "ON" } else { "OFF" }
  }
}

let dialogPanel = () => div {
  Button(variant: ButtonVariant.Primary, onClick: openDialog) { "Open dialog" }
  Dialog(open: dialogOpen, onClose: closeDialog, title: "Confirm action") {
    p(class: "text-[hsl(var(--tu-fg-muted))]") { "This is a modal dialog." }
    div(class: "mt-4 flex justify-end gap-2") {
      Button(variant: ButtonVariant.Ghost, onClick: closeDialog) { "Cancel" }
      Button(variant: ButtonVariant.Primary, onClick: closeDialog) { "Confirm" }
    }
  }
}

export let App = () => div(class: "max-w-3xl mx-auto p-8 space-y-6") {
  header {
    h1(class: "text-3xl font-bold") {
      "tu-xing "
      Badge(variant: BadgeVariant.Outline) { "图形" }
    }
    p(class: "mt-2 text-[hsl(var(--tu-fg-muted))]") {
      "Tu-native UI primitives — Tailwind-driven, theme-tokenised, copy-paste friendly."
    }
  }

  Card(title: "Components", description: "Click around — every interaction is a Signal cell.") {
    Tabs(
      items: ["buttons", "inputs", "badges", "switch", "dialog"],
      active: activeTab,
      onSelect: setTab,
    )
    div(class: "pt-6") {
      if (activeTab == "buttons") { buttonsPanel() }
      else if (activeTab == "inputs") { inputsPanel() }
      else if (activeTab == "badges") { badgesPanel() }
      else if (activeTab == "switch") { switchPanel() }
      else { dialogPanel() }
    }
  }

  Card(title: "Counter", description: "Reactive state still works — components are just functions.") {
    p(class: "text-5xl font-bold tabular-nums text-[hsl(var(--tu-brand))]") { count }
    div(class: "mt-4 flex gap-2") {
      Button(variant: ButtonVariant.Primary, onClick: () => count = count + 1) { "+1" }
      Button(variant: ButtonVariant.Secondary, onClick: () => count = count - 1) { "−1" }
      Button(variant: ButtonVariant.Ghost, onClick: () => count = 0) { "Reset" }
    }
  }
}
