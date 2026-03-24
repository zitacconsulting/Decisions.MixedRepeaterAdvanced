using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Decisions.Silverlight.UI.Forms;
using DecisionsFramework.ComponentData;
using DecisionsFramework.Design.ConfigurationStorage.Attributes;
using DecisionsFramework.Design.Form.ComponentData.CompositeControls;
using DecisionsFramework.Design.Properties;
using DecisionsFramework.ServiceLayer.Services.ConfigurationStorage;
using DecisionsFramework.ServiceLayer.Services.ContextData;
using DecisionsFramework.ServiceLayer.Utilities;
using Silverdark.Components;

namespace Decisions.MixedRepeaterAdvanced;

public class MixedRepeaterAdvanced : UserControlListContainer
{
    public MixedRepeaterAdvanced()
    {
        ComponentName = "Advanced Mixed Repeater";
    }

    private bool _dragToReorder;
    [ClientOption]
    [WritableValue]
    [PropertyClassification(2, "Enable Drag Options", new[] { "Common Properties" })]
    public bool DragToReorder
    {
        get => _dragToReorder;
        set { _dragToReorder = value; OnPropertyChanged(nameof(DragToReorder)); }
    }

    private bool _showDragHandle;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("DragToReorder", false)]
    [PropertyClassification(3, "Show Drag Handle", new[] { "Common Properties" })]
    public bool ShowDragHandle
    {
        get => _showDragHandle;
        set { _showDragHandle = value; OnPropertyChanged(nameof(ShowDragHandle)); }
    }

    private bool _triggerValueChangedOnReorder;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("DragToReorder", false)]
    [PropertyClassification(4, "Trigger Value Changed on Reorder", new[] { "Common Properties" })]
    public bool TriggerValueChangedOnReorder
    {
        get => _triggerValueChangedOnReorder;
        set { _triggerValueChangedOnReorder = value; OnPropertyChanged(nameof(TriggerValueChangedOnReorder)); }
    }

    private bool _allowDragOut;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("DragToReorder", false)]
    [PropertyClassification(5, "Allow Drag to Other Controls", new[] { "Common Properties" })]
    public bool AllowDragOut
    {
        get => _allowDragOut;
        set { _allowDragOut = value; OnPropertyChanged(nameof(AllowDragOut)); }
    }

    // Finds all other MixedRepeaterAdvanced controls on the same form surface.
    private MixedRepeaterAdvanced[] GetSiblings() =>
        Surface?.EnumerateChildren<MixedRepeaterAdvanced>()
               .Where(c => c != this)
               .ToArray()
        ?? new MixedRepeaterAdvanced[0];

    // Provides display names for the CheckboxListEditor.
    [PropertyHidden]
    public string[] AvailableSiblingNames =>
        GetSiblings()
            .Where(c => !string.IsNullOrEmpty(c.ComponentName))
            .Select(c => c.ComponentName)
            .ToArray();

    // Stable storage: ComponentIds (UUIDs) survive renames.
    [WritableValue]
    [PropertyHidden]
    public string[] AcceptDragFromIds { get; set; }

    // UI façade: CheckboxList shows ComponentNames; getter/setter translate to/from
    // the stored UUIDs so the configuration survives a control rename.
    // [ClientOption] pushes names to JS so the match uses this.options.componentName.
    [ClientOption]
    [BooleanPropertyHidden("DragToReorder", false)]
    [CheckboxListEditor("AvailableSiblingNames", "No other Mixed Repeater Advanced controls on this form")]
    [PropertyClassification(6, "Accept Drag From", new[] { "Common Properties" })]
    public string[] AcceptDragFrom
    {
        get
        {
            if (AcceptDragFromIds == null || AcceptDragFromIds.Length == 0)
                return new string[0];
            var siblings = GetSiblings();
            return AcceptDragFromIds
                .Select(id => siblings.FirstOrDefault(s => s.ComponentId == id)?.ComponentName ?? id)
                .Where(s => !string.IsNullOrEmpty(s))
                .ToArray();
        }
        set
        {
            var siblings = GetSiblings();
            AcceptDragFromIds = (value ?? new string[0])
                .Select(name => siblings.FirstOrDefault(s => s.ComponentName == name)?.ComponentId ?? name)
                .Where(s => !string.IsNullOrEmpty(s))
                .ToArray();
            OnPropertyChanged(nameof(AcceptDragFrom));
        }
    }

    // FormSessionInfoId is internal to DecisionsFramework; use reflection to set it
    // in the same way the base class does via an object initialiser.
    private static readonly PropertyInfo _formSessionIdProp =
        typeof(RuntimeChildrenProviderChildInfo)
            .GetProperty("FormSessionInfoId",
                BindingFlags.Instance | BindingFlags.NonPublic);

    protected override RuntimeChildrenProviderChildInfo GetRunTimeChildFormSurfaceInfo(
        FormSurface formSurface)
    {
        var child = new MixedRepeaterAdvancedChildInfo(
            this, formSurface, new DataPair[0], null, null);
        _formSessionIdProp?.SetValue(child, FormSessionInfoID);
        return child;
    }

    // Derives the accepted item types automatically from the Sources (FormIds) configuration.
    // Each source form's first input data type short name is sent to JS as mraAcceptedTypes.
    // Empty array means "accept all types" (no restriction).
    [ClientOption]
    [PropertyHidden]
    public string[] MraAcceptedTypes
    {
        get
        {
            var ids = FormIds;
            if (ids == null || ids.Length == 0) return new string[0];
            var ctx = UserContextHolder.GetCurrent();
            var types = new List<string>();
            foreach (var wrapper in ids)
            {
                if (string.IsNullOrEmpty(wrapper.FormId)) continue;
                try
                {
                    var reg = ConfigurationStorageService.GetInternal(ctx, wrapper.FormId) as ElementRegistration;
                    if (reg == null) continue;
                    var inputData = reg.InputData;
                    if (inputData == null || inputData.Length == 0) continue;
                    var typeName = inputData[0].Type?.GetSimpleTypeName();
                    if (!string.IsNullOrEmpty(typeName) && typeName != "[Not Found]")
                        types.Add(typeName);
                }
                catch { /* ignore missing/invalid form IDs */ }
            }
            return types.ToArray();
        }
    }

    // Expose the form session ID to JS so the service call can route correctly.
    // The base class property has [PropertyHidden] but no [ClientOption]; we shadow it here
    // to include it in the serialised control options sent to the browser.
    [ClientOption]
    [PropertyHidden]
    public string MraFormSessionId => FormSessionInfoID ?? string.Empty;

    // When DragToReorder is enabled the JS reorders childFormSurfaceInfo so data
    // arrives in the new order. We reorder Children to match so GetValue() returns
    // the array in the correct order.
    [PropertyHidden]
    public override DataPair[] ClientData
    {
        get => base.ClientData;
        set
        {
            base.ClientData = value;

            if (!DragToReorder || value == null) return;

            var pair = value.FirstOrDefault(p => p.Name == DataName);
            var inner = (pair?.OutputValue as object[])?.Cast<DataPair>().ToArray();
            if (inner == null || inner.Length == 0) return;

            var orderedIds = inner.Select(p => p.Name).ToArray();
            var children = Children.ToArray();
            var reordered = orderedIds
                .Select(id => children.FirstOrDefault(c => c.Id == id))
                .Where(c => c != null)
                .Concat(children.Where(c => !orderedIds.Contains(c.Id)))
                .ToArray();

            Children = new ConcurrentQueue<RuntimeChildrenProviderChildInfo>(reordered);
        }
    }
}
