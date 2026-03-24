using DecisionsFramework.Design.Form;
using DecisionsFramework.ServiceLayer;
using DecisionsFramework.ServiceLayer.Services.ConfigurationStorage;

namespace Decisions.MixedRepeaterAdvanced;

public class MixedRepeaterAdvancedModule : IInitializable
{
    public void Initialize()
    {
        ConfigurationStorageService.RegisterToolboxElement(
            "Mixed Repeater Advanced",
            typeof(MixedRepeaterAdvanced).AssemblyQualifiedName,
            "User Controls",
            ElementType.FormElement);
    }
}
