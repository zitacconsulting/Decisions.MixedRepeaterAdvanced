using System;
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

        // For paged controls push an immediate page refresh over SignalR so the
        // correct items appear without the user having to navigate away and back.
        // Non-paged controls are refreshed by the client-side DataChangedEvent.
        void PushPageRefresh(MixedRepeaterAdvanced ctrl)
        {
            if (!ctrl.EnablePaging || ctrl.PageSize <= 0) return;
            var ev = new NewFormDataEvent { Data = ctrl.ClientData };
            ClientEventsService.SendEvent(
                formSessionInfoId,
                new DecisionsServerControlEventsHolder(formSessionInfoId, ev));
        }
        PushPageRefresh(src);
        PushPageRefresh(tgt);

        // Raise row lifecycle events so form rules can react.
        src.RaiseControlEvents(new MraRowRemovedEvent());
        tgt.RaiseControlEvents(new MraRowAddedEvent());

        return true;
    }

    public bool MoveChildren(AbstractUserContext userContext, string formSessionInfoId,
        string sourceControlId, string targetControlId, string[] childIds, int insertAtIndex)
    {
        var session = FormService.GetFormSessionInfo(formSessionInfoId);
        if (session == null) return false;

        var src = session.GetControlByComponentId<MixedRepeaterAdvanced>(sourceControlId);
        var tgt = session.GetControlByComponentId<MixedRepeaterAdvanced>(targetControlId);
        if (src == null || tgt == null) return false;

        // Collect in the order they appear in src.Children to preserve relative ordering.
        var children = (childIds ?? new string[0])
            .Select(id => src.Children.FirstOrDefault(c => c.Id == id))
            .Where(c => c != null)
            .ToArray();
        if (children.Length == 0) return false;

        foreach (var child in children)
            src.Children = src.Children.RemoveItem(child);

        for (int i = 0; i < children.Length; i++)
            tgt.Children.InsertAt(children[i], insertAtIndex + i);

        void PushPageRefresh(MixedRepeaterAdvanced ctrl)
        {
            if (!ctrl.EnablePaging || ctrl.PageSize <= 0) return;
            var ev = new NewFormDataEvent { Data = ctrl.ClientData };
            ClientEventsService.SendEvent(
                formSessionInfoId,
                new DecisionsServerControlEventsHolder(formSessionInfoId, ev));
        }
        PushPageRefresh(src);
        PushPageRefresh(tgt);

        src.RaiseControlEvents(new MraRowRemovedEvent());
        tgt.RaiseControlEvents(new MraRowAddedEvent());

        return true;
    }

    public MraPageResult GoToPage(AbstractUserContext userContext,
        string formSessionInfoId, string controlId, int pageIndex)
    {
        var session = FormService.GetFormSessionInfo(formSessionInfoId);
        if (session == null) return null;

        var control = session.GetControlByComponentId<MixedRepeaterAdvanced>(controlId);
        if (control == null) return null;

        var totalItems  = control.Children.Count;
        var totalPages  = control.PageSize > 0
            ? (int)Math.Ceiling((double)totalItems / control.PageSize)
            : 1;
        pageIndex = Math.Max(0, Math.Min(pageIndex, Math.Max(0, totalPages - 1)));

        control.PageIndex = pageIndex;

        // Push the new page's data to the client directly over SignalR.
        // CheckAndRaiseValueChangedEvent fires the form ValueChanged event, but that
        // event is only delivered to the browser when processed inside the normal
        // form-rule pipeline. From an external service call there is no such pipeline,
        // so the event would be queued but never sent. ClientEventsService.SendEvent
        // bypasses the pipeline and delivers immediately.
        var dataEvent = new NewFormDataEvent { Data = control.ClientData };
        ClientEventsService.SendEvent(
            formSessionInfoId,
            new DecisionsServerControlEventsHolder(formSessionInfoId, dataEvent));

        return new MraPageResult
        {
            PageIndex      = pageIndex,
            TotalPageCount = totalPages,
            TotalItemCount = totalItems
        };
    }
}
