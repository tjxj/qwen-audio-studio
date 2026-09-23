import {deleteReference, prepareReference} from "../../api";
import ReferenceLibraryPage from "./ReferenceLibraryPage";

export default function ReferenceLibraryRoute() {
  return <ReferenceLibraryPage onPrepare={prepareReference} onDiscard={deleteReference} />;
}
