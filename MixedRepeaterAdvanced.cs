using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Decisions.Silverlight.UI.Core.FormDesignerModel;
using Decisions.Silverlight.UI.Forms;
using Decisions.Silverlight.UI.Utilities;
using DecisionsFramework.ComponentData;
using DecisionsFramework.Design.ConfigurationStorage.Attributes;
using DecisionsFramework.Design.Flow.Mapping;
using DecisionsFramework.Design.Form.ComponentData.CompositeControls;
using DecisionsFramework.Design.Properties;
using DecisionsFramework.ServiceLayer.Services.ConfigurationStorage;
using DecisionsFramework.ServiceLayer.Services.ContextData;
using DecisionsFramework.ServiceLayer.Utilities;
using Silverdark.Components;

namespace Decisions.MixedRepeaterAdvanced;

public class MixedRepeaterAdvanced : UserControlListContainer, IDataProducer, ISilverFormDataProducer, ISilverFormEventsProvider
{
    public MixedRepeaterAdvanced()
    {
        ComponentName = "Advanced Mixed Repeater";
    }

    // ── Drag ─────────────────────────────────────────────────────────────────

    private bool _dragToReorder;
    [ClientOption]
    [WritableValue]
    [PropertyClassification(2, "Enable Drag Options", new[] { "Common Properties" })]
    public bool DragToReorder
    {
        get => _dragToReorder;
        set
        {
            _dragToReorder = value;
            if (!value)
            {
                _showDragHandle = false;
                _triggerValueChangedOnReorder = false;
                _allowDragOut = false;
                AcceptDragFromIds = null;
            }
            OnPropertyChanged(nameof(DragToReorder));
        }
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

    [PropertyHidden]
    public string[] AvailableSiblingNames =>
        GetSiblings()
            .Where(c => !string.IsNullOrEmpty(c.ComponentName))
            .Select(c => c.ComponentName)
            .ToArray();

    [WritableValue]
    [PropertyHidden]
    public string[] AcceptDragFromIds { get; set; }

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

    // ── Child info ────────────────────────────────────────────────────────────

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

    [ClientOption]
    [PropertyHidden]
    public string MraFormSessionId => FormSessionInfoID ?? string.Empty;

    // ── Paging ───────────────────────────────────────────────────────────────

    private bool _enablePaging;
    [ClientOption]
    [WritableValue]
    [PropertyClassification(7, "Enable Paging", new[] { "Common Properties" })]
    public bool EnablePaging
    {
        get => _enablePaging;
        set
        {
            _enablePaging = value;
            if (!value) _pageSize = 0;
            OnPropertyChanged(nameof(EnablePaging));
        }
    }

    private int _pageSize;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("EnablePaging", false)]
    [PropertyClassification(8, "Page Size", new[] { "Common Properties" })]
    public int PageSize
    {
        get => _pageSize;
        set { _pageSize = value; OnPropertyChanged(nameof(PageSize)); }
    }

    private int _pageIndex;
    [ClientOption]
    [PropertyHidden]
    public int PageIndex
    {
        get => _pageIndex;
        set { _pageIndex = value; }
    }

    [PropertyHidden]
    public int TotalPageCount =>
        (EnablePaging && PageSize > 0 && Children != null && Children.Count > 0)
            ? (int)Math.Ceiling((double)Children.Count / PageSize)
            : 1;

    // ── Selection ────────────────────────────────────────────────────────────

    private bool _allowSelection;
    [ClientOption]
    [WritableValue]
    [PropertyClassification(9, "Allow Selection", new[] { "Common Properties" })]
    public bool AllowSelection
    {
        get => _allowSelection;
        set
        {
            _allowSelection = value;
            if (!value)
            {
                _allowMultiSelect = false;
                _selectionIndicatorType = SelectionIndicatorType.None;
            }
            OnPropertyChanged(nameof(AllowSelection));
        }
    }

    private bool _allowMultiSelect;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("AllowSelection", false)]
    [PropertyClassification(10, "Allow Multi-Select", new[] { "Common Properties" })]
    public bool AllowMultiSelect
    {
        get => _allowMultiSelect;
        set { _allowMultiSelect = value; OnPropertyChanged(nameof(AllowMultiSelect)); }
    }

    private SelectionIndicatorType _selectionIndicatorType;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("AllowSelection", false)]
    [PropertyClassification(11, "Selection Indicator", new[] { "Common Properties" })]
    public SelectionIndicatorType SelectionIndicatorType
    {
        get => _selectionIndicatorType;
        set { _selectionIndicatorType = value; OnPropertyChanged(nameof(SelectionIndicatorType)); }
    }

    // Shown only when indicator = VisualIndicator.
    private int _indicatorWidth = 4;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("AllowSelection", false)]
    [PropertyHiddenByValue("SelectionIndicatorType", SelectionIndicatorType.VisualIndicator, false)]
    [PropertyClassification(12, "Indicator Width (px)", new[] { "Common Properties" })]
    public int IndicatorWidth
    {
        get => _indicatorWidth;
        set { _indicatorWidth = value; OnPropertyChanged(nameof(IndicatorWidth)); }
    }

    // Shown when AllowSelection=true and indicator != None.
    private DesignerColor _selectionColor;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("AllowSelection", false)]
    [PropertyHiddenByValue("SelectionIndicatorType", SelectionIndicatorType.None, true)]
    [PropertyClassification(13, "Selection Color", new[] { "Common Properties" })]
    public DesignerColor SelectionColor
    {
        get => _selectionColor;
        set { _selectionColor = value; OnPropertyChanged(nameof(SelectionColor)); }
    }

    // ── Selection state (not designer-configurable) ───────────────────────────

    private string _selectedItemId;
    private string[] _selectedItemIds = new string[0];

    private string SelectedRowIdKey   => ComponentId + "_selectedRowId";
    private string SelectedRowIdsKey  => ComponentId + "_selectedRowIds";

    // ── Selection output names ────────────────────────────────────────────────

    private string _selectedItemDataName;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("AllowSelection", false)]
    [PropertyClassification(0, "Selected Item Data Name", new[] { "Output Data" })]
    public string SelectedItemDataName
    {
        get => string.IsNullOrEmpty(_selectedItemDataName)
            ? "Selected " + DataName
            : _selectedItemDataName;
        set { _selectedItemDataName = value; OnPropertyChanged(nameof(SelectedItemDataName)); }
    }

    // Hidden when multi-select is on (line number is ambiguous for multiple items).
    private string _selectedItemLineNumberDataName;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("AllowSelection", false)]
    [BooleanPropertyHidden("AllowMultiSelect", true)]
    [PropertyClassification(1, "Selected Item Line Number Data Name", new[] { "Output Data" })]
    public string SelectedItemLineNumberDataName
    {
        get => string.IsNullOrEmpty(_selectedItemLineNumberDataName)
            ? "Selected " + DataName + " Line Number"
            : _selectedItemLineNumberDataName;
        set { _selectedItemLineNumberDataName = value; OnPropertyChanged(nameof(SelectedItemLineNumberDataName)); }
    }

    // Visible only when multi-select is on.
    private string _selectedItemsDataName;
    [ClientOption]
    [WritableValue]
    [BooleanPropertyHidden("AllowSelection", false)]
    [BooleanPropertyHidden("AllowMultiSelect", false)]
    [PropertyClassification(2, "Selected Items Data Name", new[] { "Output Data" })]
    public string SelectedItemsDataName
    {
        get => string.IsNullOrEmpty(_selectedItemsDataName)
            ? "Selected " + DataName + " Items"
            : _selectedItemsDataName;
        set { _selectedItemsDataName = value; OnPropertyChanged(nameof(SelectedItemsDataName)); }
    }

    // ── OutcomeScenarios ──────────────────────────────────────────────────────
    // UserControlListContainer.OutcomeScenarios is non-virtual. Explicit interface
    // implementation of IDataProducer.OutcomeScenarios takes precedence when the
    // framework calls it through the interface.
    //
    // Output shape depends on selection mode:
    //   AllowSelection = false  → base outputs only (the DataName list)
    //   AllowSelection = true, AllowMultiSelect = false → + single item + line number
    //   AllowSelection = true, AllowMultiSelect = true  → + items array (no single/line)

    OutcomeScenarioData[] IDataProducer.OutcomeScenarios
    {
        get
        {
            // Start from base (gives us the DataName list output).
            var scenarios = base.OutcomeScenarios.ToList();
            if (!AllowSelection) return scenarios.ToArray();

            var objectType = new DecisionsNativeType(typeof(object));
            var intType    = new DecisionsNativeType(typeof(int));

            void AddForExit(string exit)
            {
                if (AllowMultiSelect)
                {
                    scenarios.Add(new OutcomeScenarioData(exit, new DataDescription(objectType, SelectedItemsDataName, isList: true,  canBeNull: true, isReadOnly: false)));
                }
                else
                {
                    scenarios.Add(new OutcomeScenarioData(exit, new DataDescription(objectType, SelectedItemDataName,           isList: false, canBeNull: true, isReadOnly: false)));
                    scenarios.Add(new OutcomeScenarioData(exit, new DataDescription(intType,    SelectedItemLineNumberDataName, isList: false, canBeNull: true, isReadOnly: false)));
                }
            }

            foreach (var exit in RequiredOnOutputs ?? new string[0]) AddForExit(exit);
            foreach (var exit in OptionalOnOutputs  ?? new string[0]) AddForExit(exit);

            return scenarios.ToArray();
        }
    }

    // ── ProvidedEvents ────────────────────────────────────────────────────────
    // UserControlListContainer.ProvidedEvents is non-virtual, so the framework
    // would always see only ValueChanged when accessing through ISilverFormEventsProvider.
    // Explicit interface implementation takes precedence when called via the interface.

    FormTriggerType[] ISilverFormEventsProvider.ProvidedEvents => AllowSelection
        ? new[] { FormTriggerType.ValueChanged, FormTriggerType.SelectionChanged, FormTriggerType.RowAdded, FormTriggerType.RowRemoved }
        : new[] { FormTriggerType.ValueChanged, FormTriggerType.RowAdded, FormTriggerType.RowRemoved };

    // ── Selection data injection ──────────────────────────────────────────────
    // There are two separate paths the framework uses to read data from a control:
    //
    //   1. GetServerData() — called on every client round-trip; result goes into the
    //      live formDataDictionary that AFF rules and steps read from.
    //
    //   2. ISilverFormDataProducer.ProduceData() — called at form completion to build
    //      the outcome data that flows out of the form step.
    //
    // Both must include selection data; GetServerData() is the path that was missing.

    public override IDictionary<string, object> GetServerData()
    {
        var dict = base.GetServerData() ?? new Dictionary<string, object>();
        AppendSelectionData(dict);
        return dict;
    }

    Dictionary<string, object> ISilverFormDataProducer.ProduceData(string outcomePath)
    {
        // Let the base produce its normal data (child-form values, DataName list, etc.).
        var dict = base.ProduceData(outcomePath) ?? new Dictionary<string, object>();
        AppendSelectionData(dict);
        return dict;
    }

    // Shared helper — appends the current selection values into any output dict.
    // Only the keys declared in OutcomeScenarios are written, matching the
    // single-select vs. multi-select branching there.
    private void AppendSelectionData(IDictionary<string, object> dict)
    {
        if (!AllowSelection) return;

        var children = Children.ToArray();

        if (AllowMultiSelect)
        {
            dict[SelectedItemsDataName] = (_selectedItemIds ?? new string[0])
                .Select(id => children.FirstOrDefault(c => c.Id == id)?.DataInstance)
                .Where(d => d != null)
                .ToArray();
        }
        else
        {
            dict[SelectedItemDataName]           = null;
            dict[SelectedItemLineNumberDataName] = null;
            if (!string.IsNullOrEmpty(_selectedItemId))
            {
                var child = children.FirstOrDefault(c => c.Id == _selectedItemId);
                if (child != null)
                {
                    int idx = Array.IndexOf(children, child);
                    dict[SelectedItemDataName]           = child.DataInstance;
                    dict[SelectedItemLineNumberDataName] = idx + 1;
                }
            }
        }
    }

    // ── Server state persistence ──────────────────────────────────────────────

    public override DataPair[] GetServerStateData()
    {
        var list = base.GetServerStateData().ToList();
        if (AllowSelection)
        {
            list.Add(new DataPair(SelectedRowIdKey,
                _selectedItemId));
            list.Add(new DataPair(SelectedRowIdsKey,
                _selectedItemIds != null && _selectedItemIds.Length > 0
                    ? string.Join(",", _selectedItemIds)
                    : null));
        }
        return list.ToArray();
    }

    public override void SetServerStateData(IDictionary<string, object> serverStateData)
    {
        base.SetServerStateData(serverStateData);
        if (!AllowSelection) return;

        if (serverStateData.TryGetValue(SelectedRowIdKey, out var idVal))
            _selectedItemId = idVal as string;

        if (serverStateData.TryGetValue(SelectedRowIdsKey, out var idsVal)
            && idsVal is string csv && !string.IsNullOrEmpty(csv))
            _selectedItemIds = csv.Split(',').Where(s => !string.IsNullOrEmpty(s)).ToArray();
    }

    // Allows a flow rule to programmatically select a row by 1-based line number.
    public override bool SetServerData(IDictionary<string, object> serverData)
    {
        bool changed = base.SetServerData(serverData);
        if (!AllowSelection) return changed;

        bool selChanged = false;
        if (serverData.TryGetValue(SelectedItemLineNumberDataName, out var lineNumObj))
        {
            if (lineNumObj == null)
            {
                if (_selectedItemId != null || (_selectedItemIds != null && _selectedItemIds.Length > 0))
                {
                    _selectedItemId  = null;
                    _selectedItemIds = new string[0];
                    selChanged = true;
                }
            }
            else if (int.TryParse(lineNumObj.ToString(), out var lineNum) && lineNum > 0)
            {
                var children = Children.ToArray();
                if (lineNum <= children.Length)
                {
                    var newId = children[lineNum - 1]?.Id;
                    if (newId != _selectedItemId)
                    {
                        _selectedItemId = newId;
                        selChanged = true;
                    }
                }
            }
        }

        if (selChanged)
            RaiseControlEvents(new MraSelectionChangedEvent());

        return changed || selChanged;
    }

    // ── ClientData ───────────────────────────────────────────────────────────

    [PropertyHidden]
    public override DataPair[] ClientData
    {
        get
        {
            var selIdPair  = new DataPair(SelectedRowIdKey,
                _selectedItemId);
            var selIdsPair = new DataPair(SelectedRowIdsKey,
                _selectedItemIds != null && _selectedItemIds.Length > 0
                    ? string.Join(",", _selectedItemIds)
                    : null);

            if (!EnablePaging || PageSize <= 0)
            {
                var basePairs = base.ClientData;
                return AllowSelection
                    ? basePairs.Append(selIdPair).Append(selIdsPair).ToArray()
                    : basePairs;
            }

            // Paging path
            var all = Children.ToArray();
            var totalPages = all.Length > 0
                ? (int)Math.Ceiling((double)all.Length / PageSize)
                : 1;
            if (_pageIndex >= totalPages)
                _pageIndex = Math.Max(0, totalPages - 1);

            var page = all.Skip(_pageIndex * PageSize).Take(PageSize).ToArray();

            var pairs = new List<DataPair>
            {
                new DataPair(ComponentId ?? "", page),
                new DataPair(ForceRefreshKey, true),
                new DataPair(DataName, null),
                new DataPair("_mra_total_pages", totalPages),
                new DataPair("_mra_total_items", all.Length)
            };
            if (AllowSelection) { pairs.Add(selIdPair); pairs.Add(selIdsPair); }
            return pairs.ToArray();
        }
        set
        {
            base.ClientData = value;
            if (value == null) return;

            // Drag-reorder: rebuild Children queue to match client DOM order.
            if (DragToReorder)
            {
                var pair  = value.FirstOrDefault(p => p.Name == DataName);
                var inner = (pair?.OutputValue as object[])?.Cast<DataPair>().ToArray();
                if (inner != null && inner.Length > 0)
                {
                    var orderedIds = inner.Select(p => p.Name).ToArray();
                    var children   = Children.ToArray();
                    var reordered  = orderedIds
                        .Select(id => children.FirstOrDefault(c => c.Id == id))
                        .Where(c => c != null)
                        .Concat(children.Where(c => !orderedIds.Contains(c.Id)))
                        .ToArray();
                    Children = new ConcurrentQueue<RuntimeChildrenProviderChildInfo>(reordered);
                }
            }

            // Selection: read back state sent by the client via getValue()/getValueAsync().
            if (AllowSelection)
            {
                var selPair = value.FirstOrDefault(p => p.Name == SelectedRowIdKey);
                if (selPair != null) _selectedItemId = selPair.OutputValue as string;

                var selsPair = value.FirstOrDefault(p => p.Name == SelectedRowIdsKey);
                if (selsPair?.OutputValue is string csv && !string.IsNullOrEmpty(csv))
                    _selectedItemIds = csv.Split(',').Where(s => !string.IsNullOrEmpty(s)).ToArray();
                else if (selsPair != null)
                    _selectedItemIds = new string[0];
            }
        }
    }
}

// ── Server-side form trigger events ──────────────────────────────────────────
// These let form designers attach rules to MRA events (SelectionChanged, RowAdded,
// RowRemoved) exactly as they would for a Data Repeater.

internal sealed class MraSelectionChangedEvent : IDecisionsControlServerEvent
{
    public string EventName => "Selection Changed";
    public FormTriggerType? Event => FormTriggerType.SelectionChanged;
}

internal sealed class MraRowAddedEvent : IDecisionsControlServerEvent
{
    public string EventName => "Row Added";
    public FormTriggerType? Event => FormTriggerType.RowAdded;
}

internal sealed class MraRowRemovedEvent : IDecisionsControlServerEvent
{
    public string EventName => "Row Removed";
    public FormTriggerType? Event => FormTriggerType.RowRemoved;
}
