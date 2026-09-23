import {useQuery, useQueryClient} from "@tanstack/react-query";
import {listJobs, retryJob} from "../../api";
import HistoryPage from "./HistoryPage";

export default function HistoryRoute() {
  const client = useQueryClient();
  const query = useQuery({queryKey: ["jobs"], queryFn: listJobs, refetchInterval: 2000});
  return (
    <HistoryPage
      jobs={query.data || []}
      onRetry={(id) => void retryJob(id).then(() => client.invalidateQueries({queryKey: ["jobs"]}))}
    />
  );
}
