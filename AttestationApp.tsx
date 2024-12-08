"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wallet, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { db } from '@/config/firebase';
import { EAS } from "@ethereum-attestation-service/eas-sdk";
import { ethers } from 'ethers';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot,
  updateDoc,
  doc,
  getDocs 
} from 'firebase/firestore';

declare global {
  interface Window {
    ethereum: any;
  }
}

interface Statement {
  id?: string;
  content: string;
  author: string;
  attestations: string[];
  timestamp: string;
  attestationId?: string;
}

const AVALANCHE_CHAIN_ID = '0xa86a'; // 43114 in hex
const EAS_CONTRACT_ADDRESS = "0x5B51697d5230c77d08669829bf3Fc4C2eB925634"; // 
const SCHEMA_UID = "0x5ff28f77c14df8f8f27dc94d27f01a95a40584fee056f42bd689cdffd5b46322"; // 
const RESOLVER_ADDRESS = "0x5cc6e13cfcf5aca1fb546afbfe5c09bd6065df38"; 

const AttestationApp = () => {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [newStatement, setNewStatement] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkWallet();

    console.log('Firebase Project ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);

    // Subscribe to Firestore updates
    const q = query(
      collection(db, 'statements'),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const statementsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Statement[];
      console.log('Received database update:', statementsData);
      setStatements(statementsData);
    }, (error) => {
      console.error("Database subscription error:", error);
    });

    const handleAccountChange = async (accounts: string[]) => {
      setWalletAddress(accounts[0] || '');
      setError('');
    };

    const handleChainChange = () => {
      window.location.reload();
    };

    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountChange);
      window.ethereum.on('chainChanged', handleChainChange);
    }

    return () => {
      unsubscribe(); // Cleanup Firestore subscription
      if (typeof window !== 'undefined' && window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountChange);
        window.ethereum.removeListener('chainChanged', handleChainChange);
      }
    };
  }, []);

  const checkNetwork = async () => {
    if (!window.ethereum) return false;
    
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== AVALANCHE_CHAIN_ID) {
        const switched = await switchToAvalanche();
        return switched;
      }
      return true;
    } catch (error) {
      console.error('Error checking network:', error);
      return false;
    }
  };

  const switchToAvalanche = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: AVALANCHE_CHAIN_ID }],
      });
      return true;
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: AVALANCHE_CHAIN_ID,
                chainName: 'Avalanche C-Chain',
                nativeCurrency: {
                  name: 'AVAX',
                  symbol: 'AVAX',
                  decimals: 18
                },
                rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
                blockExplorerUrls: ['https://snowtrace.io/']
              },
            ],
          });
          return true;
        } catch (addError) {
          console.error('Error adding Avalanche network:', addError);
          return false;
        }
      }
      console.error('Error switching to Avalanche network:', switchError);
      return false;
    }
  };


  const testDatabase = async () => {
    try {
      console.log('Starting database test...');
      
      const docRef = await addDoc(collection(db, 'statements'), {
        content: "Test statement",
        author: "Test author",
        attestations: [],
        timestamp: new Date().toISOString()
      });
      console.log("✅ Write test successful - Document written with ID:", docRef.id);

      const querySnapshot = await getDocs(collection(db, 'statements'));
      console.log("📚 Current database contents:");
      querySnapshot.forEach((doc) => {
        console.log(`Document ${doc.id} =>`, doc.data());
      });

      alert('Database test successful! Check console for details.');
    } catch (error) {
      console.error("❌ Database test failed:", error);
      alert('Database test failed! Check console for details.');
    }
  };

  const checkWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('Please install MetaMask to use this app');
      return;
    }
    
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts[0]) {
        setWalletAddress(accounts[0]);
        await checkNetwork();
      }
    } catch (error) {
      setError('Error checking wallet connection');
      console.error('Error checking wallet:', error);
    }
  };

  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('Please install MetaMask to use this app');
      return;
    }

    setIsLoading(true);
    setError('');
    
    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });
      setWalletAddress(accounts[0]);
      
      const isCorrectNetwork = await checkNetwork();
      if (!isCorrectNetwork) {
        setError('Please switch to the Avalanche network');
      }
    } catch (error: any) {
      if (error.code === 4001) {
        setError('Please connect your wallet to continue');
      } else {
        setError('Error connecting to wallet');
      }
      console.error('Connection error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const addStatement = async () => {
    if (!newStatement.trim() || !walletAddress) return;
    setIsLoading(true);

    try {
      console.log('Adding new statement to database...');
      const statement = {
        content: newStatement,
        author: walletAddress,
        attestations: [],
        timestamp: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'statements'), statement);
      console.log('✅ Statement added successfully with ID:', docRef.id);
      setNewStatement('');
    } catch (error) {
      console.error('❌ Error adding statement:', error);
      setError('Error adding statement');
    } finally {
      setIsLoading(false);
    }
  };

  const makeAttestation = async (statement: Statement) => {
    if (!walletAddress || !statement.id) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const isCorrectNetwork = await checkNetwork();
      if (!isCorrectNetwork) {
        setError('Please switch to the Avalanche network');
        return;
      }
  
      // Create provider and signer
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
  
      // Initialize EAS
      const eas = new EAS(EAS_CONTRACT_ADDRESS);
      eas.connect(signer);
  
      // Create attestation with proper AttestationRequest structure
      const attestation = await eas.attest({
        schema: SCHEMA_UID,
        data: {
          recipient: ethers.ZeroAddress,
          expirationTime: BigInt(0),
          revocable: true,
           ethers.encodeBytes32String(statement.content)  // Fixed: properly set the data property
        }
      });
  
      console.log('✅ Transaction submitted:', attestation);
      const receipt = await attestation.wait();
      console.log('✅ Transaction confirmed:', receipt);
  
      // Update Firestore
      const statementRef = doc(db, 'statements', statement.id);
      await updateDoc(statementRef, {
        attestations: [...statement.attestations, walletAddress],
        attestationId: receipt.transactionHash
      });
      console.log('✅ Database updated with attestation');
  
    } catch (error: any) {
      console.error('❌ Full error:', error);
      
      if (error.code === 4001) {
        setError('Transaction rejected');
      } else {
        setError('Error making attestation: ' + error.message);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  const formatAddress = (address: string) => {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Attestations</h1>
          <Button 
            onClick={testDatabase}
            variant="outline"
            size="sm"
          >
            Test DB
          </Button>
        </div>
        <Button 
          variant={walletAddress ? "outline" : "default"}
          onClick={connectWallet}
          disabled={isLoading}
        >
          <Wallet className="mr-2 h-4 w-4" />
          {isLoading ? "Connecting..." : 
           walletAddress ? formatAddress(walletAddress) : "Connect Wallet"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Make a statement..."
          value={newStatement}
          onChange={(e) => setNewStatement(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && addStatement()}
          disabled={!walletAddress || isLoading}
        />
        <Button 
          onClick={addStatement}
          disabled={!walletAddress || !newStatement.trim() || isLoading}
        >
          Post
        </Button>
      </div>

      <div className="space-y-2">
        {statements.map(statement => (
          <Card key={statement.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="space-y-1">
                <p>{statement.content}</p>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>by {formatAddress(statement.author)}</span>
                  <span>•</span>
                  <span>{formatDate(statement.timestamp)}</span>
                  {statement.attestationId && (
                    <>
                      <span>•</span>
                      <span className="text-xs">
                        TX: {formatAddress(statement.attestationId)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">
                  {statement.attestations.length} attestations
                </span>
                {walletAddress && 
                  statement.author !== walletAddress && 
                  !statement.attestations.includes(walletAddress) && (
                  <Button 
                    variant="outline"
                    onClick={() => makeAttestation(statement)}
                    disabled={isLoading}
                  >
                    Attest
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AttestationApp;
