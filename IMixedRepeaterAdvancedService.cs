using System.ServiceModel;
using DecisionsFramework.ServiceLayer;
using DecisionsFramework.ServiceLayer.Services.ContextData;
using DecisionsFramework.ServiceLayer.Utilities;

namespace Decisions.MixedRepeaterAdvanced;

[ServiceContract]
public interface IMixedRepeaterAdvancedService : IAuthenticatedService
{
    [OperationContract]
    bool MoveChild(AbstractUserContext userContext, string formSessionInfoId,
        string sourceControlId, string targetControlId, string childId, int insertAtIndex);
}
