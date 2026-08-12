import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Building2, MapPin, X } from 'lucide-react';
import { Client } from '@/lib/types';

export interface SearchCriteria {
  unit: string;
  streetAddress: string;
  city: string;
  province: string;
  name: string;
}

interface ClientSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  onClientSelect: (client: Client) => void;
  onSearch?: (criteria: SearchCriteria) => void;
}

export function ClientSearchDialog({
  open,
  onOpenChange,
  clients,
  onClientSelect,
  onSearch,
}: ClientSearchDialogProps) {
  const [unit, setUnit] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('all');
  const [province, setProvince] = useState('all');
  const [name, setName] = useState('');

  // Extract unique cities and provinces from clients
  const uniqueCities = Array.from(
    new Set(
      clients
        .map(c => c.location.split(',')[0]?.trim())
        .filter(Boolean)
    )
  ).sort();

  const uniqueProvinces = Array.from(
    new Set(
      clients
        .map(c => c.location.split(',')[1]?.trim())
        .filter(Boolean)
    )
  ).sort();

  const resetSearch = () => {
    setUnit('');
    setStreetAddress('');
    setCity('all');
    setProvince('all');
    setName('');
  };

  const handleClose = () => {
    resetSearch();
    onOpenChange(false);
  };

  // Filter clients based on search criteria
  const matchingClients = clients.filter((client) => {
    // If no search criteria, return nothing
    const hasCityFilter = city !== 'all';
    const hasProvinceFilter = province !== 'all';
    const hasSearchCriteria = streetAddress || hasCityFilter || hasProvinceFilter || name || unit;
    
    if (!hasSearchCriteria) {
      return false;
    }

    let matches = true;

    // Address matching
    if (streetAddress) {
      matches = matches && client.address.toLowerCase().includes(streetAddress.toLowerCase());
    }
    if (hasCityFilter) {
      const clientCity = client.location.split(',')[0]?.trim();
      matches = matches && clientCity === city;
    }
    if (hasProvinceFilter) {
      const clientProvince = client.location.split(',')[1]?.trim();
      matches = matches && clientProvince === province;
    }
    if (unit) {
      matches = matches && client.address.toLowerCase().includes(unit.toLowerCase());
    }

    // Name matching - works independently or in combination with address
    if (name) {
      matches = matches && client.name.toLowerCase().includes(name.toLowerCase());
    }

    return matches;
  });

  const handleClientClick = (client: Client) => {
    onClientSelect(client);
    handleClose();
  };

  const handleSearch = () => {
    if (onSearch) {
      onSearch({ unit, streetAddress, city, province, name });
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Search Clients</DialogTitle>
          <DialogDescription>
            Search for clients by address and unit, then optionally filter by name
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <div className="space-y-4">
            {/* City and Province Filters */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="search-city">City</Label>
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger id="search-city">
                    <SelectValue placeholder="All Cities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Cities</SelectItem>
                    {uniqueCities.map((cityOption) => (
                      <SelectItem key={cityOption} value={cityOption}>
                        {cityOption}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="search-province">Province</Label>
                <Select value={province} onValueChange={setProvince}>
                  <SelectTrigger id="search-province">
                    <SelectValue placeholder="All Provinces" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Provinces</SelectItem>
                    {uniqueProvinces.map((provinceOption) => (
                      <SelectItem key={provinceOption} value={provinceOption}>
                        {provinceOption}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Unit and Street Address */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="search-unit">Unit / Suite</Label>
                <Input
                  id="search-unit"
                  placeholder="e.g., Suite 500"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>

              <div className="col-span-2 space-y-2">
                <Label htmlFor="search-street">Street Address</Label>
                <Input
                  id="search-street"
                  placeholder="Start typing address..."
                  value={streetAddress}
                  onChange={(e) => setStreetAddress(e.target.value)}
                />
              </div>
            </div>

            {/* Name Search - Always visible below address */}
            <div className="space-y-2">
              <Label htmlFor="search-name">Client Name</Label>
              <Input
                id="search-name"
                placeholder="Search by client name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Clear Filters */}
            {(unit || streetAddress || city !== 'all' || province !== 'all' || name) && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={resetSearch}
                className="w-full"
              >
                <X className="h-4 w-4 mr-2" />
                Clear All Filters
              </Button>
            )}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">
                Results Preview {matchingClients.length > 0 && `(${matchingClients.length})`}
              </h4>
              {matchingClients.length > 0 && onSearch && (
                <Button onClick={handleSearch} size="sm">
                  <Search className="h-4 w-4 mr-2" />
                  Search ({matchingClients.length})
                </Button>
              )}
            </div>
            
            <ScrollArea className="flex-1 border rounded-md">
              {matchingClients.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>
                    {unit || streetAddress || city !== 'all' || province !== 'all' || name
                      ? 'No clients match your search criteria'
                      : 'Select filters or enter an address to search for clients'}
                  </p>
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {matchingClients.map((client) => (
                    <div
                      key={client.id}
                      className="w-full text-left p-4 rounded-lg border bg-card"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-foreground truncate">
                              {client.name}
                            </h3>
                            {client.status && (
                              <Badge variant="secondary" className="capitalize">
                                {client.status.replace('_', ' ')}
                              </Badge>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Building2 className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{client.industry}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{client.address}</span>
                            </div>
                          </div>
                          {client.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {client.tags.map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
