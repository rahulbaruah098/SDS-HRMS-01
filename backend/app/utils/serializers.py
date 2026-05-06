from bson import ObjectId
from datetime import datetime, date
def clean_doc(doc):
    if doc is None: return None
    if isinstance(doc, list): return [clean_doc(x) for x in doc]
    if isinstance(doc, dict):
        out={}
        for k,v in doc.items():
            if isinstance(v,ObjectId): out[k]=str(v)
            elif isinstance(v,(datetime,date)): out[k]=v.isoformat()
            elif isinstance(v,(dict,list)): out[k]=clean_doc(v)
            else: out[k]=v
        return out
    return doc
