import { useRef } from 'react';
import { Camera, Contact, MapPin, Phone, Trash2, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { AddressAutocompleteInput } from './AddressAutocompleteInput';
import { FieldError, FieldLabel, SectionCard } from './SectionCard';
import { PROVINCES, type EmployeeFormState, type FormErrors, type SetField } from './formTypes';
import { dateOfBirthError } from './validation';

type SectionProps = {
  form: EmployeeFormState;
  errors: FormErrors;
  setField: SetField;
};

const errCls = (msg?: string) => (msg ? 'border-destructive' : undefined);

export function formatCanadianPostalCode(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
}

// ── Profile photo ──────────────────────────────────────────────────────────

export function ProfilePhotoCard({
  photoUrl,
  initials,
  onPhotoSelected,
  onRemovePhoto,
}: {
  photoUrl: string | null;
  initials: string;
  onPhotoSelected: (file: File) => void;
  onRemovePhoto: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please choose an image file.', variant: 'destructive' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max photo size is 10MB.', variant: 'destructive' });
      return;
    }
    onPhotoSelected(file);
  };

  return (
    <SectionCard
      icon={Camera}
      title="Profile Photo"
      description="A clear, recent headshot helps clients recognize the employee."
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleSelect(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-4">
        <Avatar className="h-20 w-20 border">
          {photoUrl && <AvatarImage src={photoUrl} alt="Profile photo" className="object-cover" />}
          <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
            {initials || <UserRound className="h-8 w-8" />}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            {photoUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {photoUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onRemovePhoto}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ── Personal information ───────────────────────────────────────────────────

export function PersonalInfoCard({ form, errors, setField }: SectionProps) {
  return (
    <SectionCard icon={UserRound} title="Personal Information" required>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5" data-field="firstName">
          <FieldLabel required>First Name</FieldLabel>
          <Input
            value={form.firstName}
            onChange={(e) => setField('firstName', e.target.value)}
            placeholder="Enter first name"
            className={errCls(errors.firstName)}
            maxLength={100}
          />
          <FieldError message={errors.firstName} />
        </div>
        <div className="space-y-1.5" data-field="lastName">
          <FieldLabel required>Last Name</FieldLabel>
          <Input
            value={form.lastName}
            onChange={(e) => setField('lastName', e.target.value)}
            placeholder="Enter last name"
            className={errCls(errors.lastName)}
            maxLength={100}
          />
          <FieldError message={errors.lastName} />
        </div>
        {(() => {
          const dobErr = errors.dateOfBirth ?? dateOfBirthError(form.dateOfBirth);
          return (
            <div className="space-y-1.5" data-field="dateOfBirth">
              <FieldLabel>Date of Birth</FieldLabel>
              <Input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => setField('dateOfBirth', e.target.value)}
                className={errCls(dobErr)}
                max={new Date().toISOString().slice(0, 10)}
              />
              <FieldError message={dobErr} />
            </div>
          );
        })()}
        <div className="space-y-1.5" data-field="gender">
          <FieldLabel required>Gender</FieldLabel>
          <Select
            value={form.gender}
            onValueChange={(v) => setField('gender', v as EmployeeFormState['gender'])}
          >
            <SelectTrigger className={errCls(errors.gender)}>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <FieldError message={errors.gender} />
        </div>
      </div>
    </SectionCard>
  );
}

// ── Contact information ────────────────────────────────────────────────────

export function ContactInfoCard({ form, errors, setField }: SectionProps) {
  return (
    <SectionCard icon={Phone} title="Contact Information" required>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5" data-field="email">
          <FieldLabel required>Email Address</FieldLabel>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            placeholder="Enter email address"
            className={errCls(errors.email)}
            maxLength={255}
          />
          <FieldError message={errors.email} />
        </div>
        <div className="space-y-1.5" data-field="phone">
          <FieldLabel required>Phone Number</FieldLabel>
          <Input
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value)}
            placeholder="Enter phone number"
            className={errCls(errors.phone)}
            maxLength={50}
          />
          <FieldError message={errors.phone} />
        </div>
      </div>
    </SectionCard>
  );
}

// ── Address ────────────────────────────────────────────────────────────────

export function AddressCard({ form, errors, setField }: SectionProps) {
  return (
    <SectionCard
      icon={MapPin}
      title="Address"
      description="Start typing to search with Google Places, or enter manually."
      required
    >
      <div className="space-y-1.5" data-field="address">
        <FieldLabel required>Street Address</FieldLabel>
        <AddressAutocompleteInput
          value={form.address}
          onChange={(v) => setField('address', v)}
          onPlaceSelected={(place) => {
            if (place.city) setField('city', place.city);
            if (place.province && PROVINCES.includes(place.province)) {
              setField('province', place.province);
            }
            if (place.postalCode) setField('postalCode', formatCanadianPostalCode(place.postalCode));
          }}
          className={errCls(errors.address)}
        />
        <FieldError message={errors.address} />
      </div>
      <div className="space-y-1.5">
        <FieldLabel>Unit / Suite (optional)</FieldLabel>
        <Input
          value={form.addressLine2}
          onChange={(e) => setField('addressLine2', e.target.value)}
          placeholder="Apt, suite, unit…"
          className={errCls(errors.addressLine2)}
          maxLength={500}
        />
        <FieldError message={errors.addressLine2} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5" data-field="city">
          <FieldLabel required>City</FieldLabel>
          <Input
            value={form.city}
            onChange={(e) => setField('city', e.target.value)}
            placeholder="Enter city"
            className={errCls(errors.city)}
            maxLength={100}
          />
          <FieldError message={errors.city} />
        </div>
        <div className="space-y-1.5" data-field="province">
          <FieldLabel required>Province</FieldLabel>
          <Select value={form.province} onValueChange={(v) => setField('province', v)}>
            <SelectTrigger className={errCls(errors.province)}>
              <SelectValue placeholder="Select province" />
            </SelectTrigger>
            <SelectContent>
              {PROVINCES.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.province} />
        </div>
        <div className="space-y-1.5" data-field="postalCode">
          <FieldLabel required>Postal Code</FieldLabel>
          <Input
            value={form.postalCode}
            onChange={(e) => setField('postalCode', formatCanadianPostalCode(e.target.value))}
            placeholder="A1A 1A1"
            className={errCls(errors.postalCode)}
            maxLength={7}
          />
          <FieldError message={errors.postalCode} />
        </div>
      </div>
    </SectionCard>
  );
}

// ── Emergency contact ──────────────────────────────────────────────────────

export function EmergencyContactCard({ form, errors, setField }: SectionProps) {
  return (
    <SectionCard icon={Contact} title="Emergency Contact" required>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5" data-field="emergencyContactName">
          <FieldLabel required>Contact Name</FieldLabel>
          <Input
            value={form.emergencyContactName}
            onChange={(e) => setField('emergencyContactName', e.target.value)}
            placeholder="Enter contact name"
            className={errCls(errors.emergencyContactName)}
            maxLength={200}
          />
          <FieldError message={errors.emergencyContactName} />
        </div>
        <div className="space-y-1.5" data-field="emergencyContactPhone">
          <FieldLabel required>Contact Phone</FieldLabel>
          <Input
            value={form.emergencyContactPhone}
            onChange={(e) => setField('emergencyContactPhone', e.target.value)}
            placeholder="Enter contact phone"
            className={errCls(errors.emergencyContactPhone)}
            maxLength={50}
          />
          <FieldError message={errors.emergencyContactPhone} />
        </div>
      </div>
    </SectionCard>
  );
}
