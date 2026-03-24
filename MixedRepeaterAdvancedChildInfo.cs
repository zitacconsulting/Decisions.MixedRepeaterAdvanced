using System.Collections.Generic;
using System.Runtime.Serialization;
using DecisionsFramework.ComponentData;
using DecisionsFramework.Design.Form;
using DecisionsFramework.Design.Form.ComponentData.CompositeControls;
using DecisionsFramework.ServiceLayer.Services.ContextData;

namespace Decisions.MixedRepeaterAdvanced;

/// <summary>
/// Extends UserControlListContainerChildInfo with a persisted ItemTypeName so the
/// .NET type of the data instance survives form-session serialization/deserialization.
/// DataInstance is NOT a [DataMember] in the base class, so after a round-trip it is
/// null. The getter derives the name from DataInstance when it is available (first
/// render) and falls back to the stored value on subsequent requests.
/// </summary>
[DataContract]
public sealed class MixedRepeaterAdvancedChildInfo : UserControlListContainerChildInfo
{
    private string _storedTypeName = string.Empty;

    // Name is explicitly set to camelCase so JS can access it as surfaceInfo.itemTypeName.
    [DataMember(Name = "itemTypeName")]
    public string ItemTypeName
    {
        get => DataInstance?.GetType().FullName ?? _storedTypeName;
        set => _storedTypeName = value ?? string.Empty;
    }

    // Parameterless constructor required for DataContract deserialization.
    public MixedRepeaterAdvancedChildInfo() { }

    public MixedRepeaterAdvancedChildInfo(
        IChildSurfaceProvider parent,
        FormSurface surface,
        DataPair[] clientData,
        IDictionary<string, object> formData,
        object dataInstance)
        : base(parent, surface, clientData, formData, dataInstance) { }
}
