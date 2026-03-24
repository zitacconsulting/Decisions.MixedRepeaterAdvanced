# Advanced Mixed Repeater

> ⚠️ **Important:** Use this module at your own risk. See the **Disclaimer** section below.

A custom form control module for the [Decisions](https://decisions.com) platform that extends the built-in Mixed Type Repeater with drag-and-drop reordering and cross-control item transfer.

## Features

- **Drag-to-reorder** — users can reorder items within a repeater by dragging them up or down the list.
- **Cross-control drag** — items can be moved between multiple Advanced Mixed Repeater controls on the same form, configurable per control via the *Accept Drag From* property.
- **Datatype-aware restrictions** — item transfers are automatically restricted based on the data types defined in each control's Sources list. An item can only be dropped onto a control that has a matching source type, preventing incompatible moves without any manual configuration.
- **Drag handle** — an optional grab handle can be shown on each item to make draggable rows more discoverable.
- **Cursor feedback** — the cursor changes to indicate whether a drop is permitted or prohibited at the current position.

## Requirements

- Decisions 9.21 or later

## Installation

### Option 1: Install Pre-built Module
1. Download the compiled module (`.zip` file)
2. Log into the Decisions Portal
3. Navigate to **System > Administration > Features**
4. Click **Install Module**
5. Upload the `.zip` file
6. Restart the Decisions service if prompted

### Option 2: Build from Source
See the [Building from Source](#building-from-source) section below.

## Configuration

Once installed, the **Advanced Mixed Repeater** control appears in the form toolbox under *User Controls*.

| Property | Description |
|---|---|
| Enable Drag Options | Master switch that enables drag-to-reorder and all cross-control drag features. Must be enabled for any drag functionality to work. |
| Show Drag Handle | Displays a grab handle on each item to make draggable rows more discoverable. |
| Trigger Value Changed on Reorder | Fires the form's value-changed event after a successful reorder or cross-control move. |
| Allow Drag to Other Controls | Allows items to be dragged out of this control into another. Must be enabled on the **source** control. |
| Accept Drag From | Selects which other Advanced Mixed Repeater controls on this form are allowed to drag items into this control. Must be configured on the **destination** control. |

### Setting Up Cross-Control Drag

Cross-control drag requires configuration on both the source and destination controls:

1. On the **source** control — enable **Enable Drag Options** and enable **Allow Drag to Other Controls**.
2. On the **destination** control — enable **Enable Drag Options** and open **Accept Drag From**, then tick the source control(s) you want to allow.

A drag will only be permitted in one direction unless both controls are configured to accept from each other.

### Datatype Restrictions

Each Advanced Mixed Repeater is bound to one or more form sources (defined in its **Sources** list), each of which is tied to a specific data type. When dragging an item between controls, the module automatically checks whether the destination has a source that matches the item's data type. If no matching source exists, the drag is blocked — the cursor changes to indicate the drop is not allowed, and releasing the mouse returns the item to its original position.

This means cross-control drag only works when the types are compatible, and requires no additional configuration beyond setting up the Sources on each control as normal.

## Building from Source

### Prerequisites
- .NET 10.0 SDK or higher
- `CreateDecisionsModule` Global Tool (installed automatically during build)
- Decisions Platform SDK (NuGet package: `DecisionsSDK`)

### Build Steps

#### On Linux/macOS:
```bash
chmod +x build_module.sh
./build_module.sh
```

#### On Windows (PowerShell):
```powershell
.\build_module.ps1
```

#### Manual Build:
```bash
# 1. Publish the project
dotnet publish ./Decisions.MixedRepeaterAdvanced.csproj --self-contained false --output ./obj -c Release

# 2. Install/Update CreateDecisionsModule tool
dotnet tool update --global CreateDecisionsModule-GlobalTool

# 3. Create the module package
CreateDecisionsModule -buildmodule Decisions.MixedRepeaterAdvanced -output "." -buildfile Module.Build.json
```

### Build Output
The build creates `Decisions.MixedRepeaterAdvanced.zip` in the root directory. Upload it directly to Decisions via **System > Administration > Features**.

## Disclaimer

This module is provided "as is" without warranties of any kind. Use it at your own risk. The authors, maintainers, and contributors disclaim all liability for any direct, indirect, incidental, special, or consequential damages, including data loss or service interruption, arising from the use of this software.

**Important Notes:**
- Always test in a non-production environment first
- This module is not officially supported by Decisions

## License

[MIT](LICENSE)
