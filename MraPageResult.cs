using System.Runtime.Serialization;

namespace Decisions.MixedRepeaterAdvanced;

[DataContract]
public class MraPageResult
{
    [DataMember] public int PageIndex      { get; set; }
    [DataMember] public int TotalPageCount { get; set; }
    [DataMember] public int TotalItemCount { get; set; }
}
