import { useEffect, useState } from 'react';
import { Phone, PhoneMissed, Pause, User, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCallStore } from '@/lib/callStore';
import { useAgentPhoneDockLayout } from '@/lib/floatingActionDock';
import { motion, AnimatePresence } from 'framer-motion';

export function FloatingCallBubble() {
  const { activeCall, isMinimized, maximizeCall, outboundMuted } = useCallStore();
  const [isHovered, setIsHovered] = useState(false);
  const { outbound } = useAgentPhoneDockLayout();

  if (!activeCall || !isMinimized || activeCall.status === 'ended') {
    return null;
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = () => {
    switch (activeCall.status) {
      case 'connecting':
        return 'bg-yellow-500';
      case 'active':
        return 'bg-green-500';
      case 'on_hold':
        return 'bg-orange-500';
      default:
        return 'bg-primary';
    }
  };

  const getStatusIcon = () => {
    switch (activeCall.status) {
      case 'on_hold':
        return <Pause className="h-5 w-5" />;
      default:
        return <Phone className="h-5 w-5" />;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        className={cn('fixed z-[250]', outbound.left)}
        style={{ bottom: outbound.bottomPx }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Expanded view on hover */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-full left-0 mb-3 w-72"
            >
              <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className={cn("px-4 py-3 text-white", getStatusColor())}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon()}
                      <span className="font-medium capitalize">
                        {activeCall.status === 'connecting' ? 'Connecting...' : 
                         activeCall.status === 'on_hold' ? 'On Hold' : 'In Call'}
                      </span>
                      {outboundMuted && activeCall.status !== 'on_hold' && (
                        <MicOff className="h-4 w-4 opacity-80" aria-label="Muted" />
                      )}
                    </div>
                    <span className="font-mono text-sm">
                      {formatDuration(activeCall.duration)}
                    </span>
                  </div>
                </div>
                
                {/* Contact Info */}
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{activeCall.partyName || activeCall.contact?.name}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {activeCall.client?.name || activeCall.partyPhone}
                      </p>
                    </div>
                  </div>
                  
                  <button
                    onClick={maximizeCall}
                    className="w-full mt-4 py-2 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Return to Call
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Bubble */}
        <motion.button
          onClick={maximizeCall}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "relative h-16 w-16 rounded-full shadow-lg flex items-center justify-center text-white transition-colors cursor-pointer",
            getStatusColor()
          )}
        >
          {/* Pulse animation for active call */}
          {activeCall.status === 'active' && (
            <>
              <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-25" />
              <span className="absolute inset-0 rounded-full bg-green-500 animate-pulse opacity-50" />
            </>
          )}
          
          <div className="relative z-10 flex flex-col items-center">
            {getStatusIcon()}
            <span className="text-[10px] font-mono mt-0.5">
              {formatDuration(activeCall.duration)}
            </span>
          </div>
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
}
