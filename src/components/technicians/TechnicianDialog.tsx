import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { geocodeAddress } from "@/lib/geo";
import { formatUSPhone, stripPhone } from "@/lib/phone";
import { lookupZipCentroid, resolveZip } from "@/lib/zipCentroids";
import { TECHNICIANS_QUERY_KEY, upsertTechnicianInList } from "@/lib/technicians";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

export interface TechnicianRecord {
  id: string;
  name: string;
  area: string;
  service: string | null;
  notes: string | null;
  chat_link: string | null;
  phone_number: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician?: TechnicianRecord | null;
  onSaved?: (saved: TechnicianRecord) => void;
}

export function TechnicianDialog({ open, onOpenChange, technician, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [service, setService] = useState("");
  const [chatLink, setChatLink] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(technician?.name ?? "");
      setPhone(formatUSPhone(technician?.phone_number ?? ""));
      setPhoneError(null);
      setArea(technician?.area ?? "");
      setService(technician?.service ?? "");
      setChatLink(technician?.chat_link ?? "");
      setNotes(technician?.notes ?? "");
    }
  }, [open, technician]);

  const handleSubmit = async () => {
    const cleanName = name.trim();
    const cleanArea = area.trim();
    const cleanPhone = formatUSPhone(phone);
    const phoneDigits = stripPhone(cleanPhone);
    if (cleanPhone && phoneDigits.length !== 10) {
      setPhoneError("Enter a valid 10-digit U.S. phone number");
      return;
    }
    setPhoneError(null);
    setSaving(true);
    try {
      let latitude = technician?.latitude ?? null;
      let longitude = technician?.longitude ?? null;
      const areaChanged = !technician || technician.area !== cleanArea;
      if (areaChanged && cleanArea) {
        const zip = resolveZip({ address: cleanArea });
        const centroid = await lookupZipCentroid(zip);
        const coords = centroid ?? await geocodeAddress(cleanArea);
        if (coords) {
          latitude = coords.latitude;
          longitude = coords.longitude;
        } else {
          latitude = null;
          longitude = null;
        }
      } else if (!cleanArea) {
        latitude = null;
        longitude = null;
      }

      const payload = {
        name: cleanName,
        area: cleanArea,
        phone_number: cleanPhone || null,
        service: service.trim() || null,
        chat_link: chatLink.trim() || null,
        notes: notes.trim() || null,
        latitude,
        longitude,
      };

      const SELECT = "id, name, area, service, notes, chat_link, phone_number, latitude, longitude";
      let saved: TechnicianRecord | null = null;
      let error: { message: string } | null = null;
      if (technician) {
        const res = await supabase.from("technicians").update(payload).eq("id", technician.id).select(SELECT).single();
        error = res.error;
        saved = (res.data as TechnicianRecord | null) ?? null;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const res = await supabase.from("technicians").insert({ ...payload, created_by: user?.id ?? null }).select(SELECT).single();
        error = res.error;
        saved = (res.data as TechnicianRecord | null) ?? null;
      }

      if (error || !saved?.id) {
        toast({ title: "Save failed", description: error?.message ?? "Could not verify the saved technician.", variant: "destructive" });
      } else {
        const geoWarn = !!cleanArea && (latitude == null || longitude == null);
        queryClient.setQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY, (current) =>
          upsertTechnicianInList(current, saved),
        );
        toast({
          title: technician ? "Technician updated" : "Technician added",
          description: geoWarn ? "Saved, but the area could not be located on the map." : undefined,
        });
        if (!technician) setPhone("");
        onSaved?.(saved);
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{technician ? "Edit Technician" : "Add Technician"}</DialogTitle>
          <DialogDescription>Manage a technician for the Map View.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tech-name">Technician Name</Label>
            <Input id="tech-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Smith" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-phone">Phone Number</Label>
            <Input
              id="tech-phone"
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(formatUSPhone(e.target.value)); if (phoneError) setPhoneError(null); }}
              placeholder="e.g. (305) 555-0123"
              inputMode="tel"
              autoComplete="tel"
              maxLength={14}
            />
            {phoneError && <p className="text-[11px] text-destructive">{phoneError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-area">Area</Label>
            <Input id="tech-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Miami, FL or 33101" />
            <p className="text-[11px] text-muted-foreground">City & state, ZIP code, or full address. Used to place the marker.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-service">Service</Label>
            <Input id="tech-service" value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. Plumbing" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-chat">Quo Chat Link</Label>
            <Input id="tech-chat" value={chatLink} onChange={(e) => setChatLink(e.target.value)} placeholder="https://app.openphone.com/..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-notes">Notes</Label>
            <Textarea id="tech-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {technician ? "Save Changes" : "Add Technician"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
