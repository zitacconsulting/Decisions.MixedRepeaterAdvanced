using System.Linq;
using DecisionsFramework.Design.Form;
using DecisionsFramework.ServiceLayer;
using DecisionsFramework.ServiceLayer.Services.ClientEvents;
using DecisionsFramework.ServiceLayer.Services.ContextData;
using DecisionsFramework.ServiceLayer.Utilities;
using DecisionsFramework.Utilities.Extensions;

namespace Decisions.MixedRepeaterAdvanced;

[RegisterUser]
[AutoRegisterService("MixedRepeaterAdvancedService", typeof(IMixedRepeaterAdvancedService))]
[HoldEvents]
[LogCallStart]
[LogCallEnd]
public sealed class MixedRepeaterAdvancedService : AuthenticatedService, IMixedRepeaterAdvancedService, IAuthenticatedService
{
    public bool MoveChild(AbstractUserContext userContext, string formSessionInfoId,
        string sourceControlId, string targetControlId, string childId, int insertAtIndex)
    {
        var session = FormService.GetFormSessionInfo(formSessionInfoId);
        if (session == null) return false;

        var src = session.GetControlByComponentId<MixedRepeaterAdvanced>(sourceControlId);
        var tgt = session.GetControlByComponentId<MixedRepeaterAdvanced>(targetControlId);
        if (src == null || tgt == null) return false;

        var child = src.Children.FirstOrDefault(c => c.Id == childId);
        if (child == null) return false;

        src.Children = src.Children.RemoveItem(child);
        tgt.Children.InsertAt(child, insertAtIndex);
        return true;
    }
}
