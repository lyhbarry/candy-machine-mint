import "./Home.css"

import { useEffect, useState } from "react";
import styled from "styled-components";
import Countdown from "react-countdown";
import { Button, CircularProgress, Snackbar } from "@material-ui/core";
import Alert from "@material-ui/lab/Alert";

import * as anchor from "@project-serum/anchor";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletDialogButton } from "@solana/wallet-adapter-material-ui";

import twitterLogo from "./assets/twitter-logo.svg"
import jellyBabiesGIF from "./assets/jellybabies.gif"

import {
  CandyMachine,
  awaitTransactionSignatureConfirmation,
  getCandyMachineState,
  mintToken,
  shortenAddress,
  mintMultipleToken,
} from "./candy-machine";
import { sleep } from "./utils/utilities";

const ConnectButton = styled(WalletDialogButton)``;

const CounterText = styled.span``; // add your styles here

const MintContainer = styled.div``; // add your styles here

const MintButton = styled(Button)``; // add your styles here

export interface HomeProps {
  candyMachineId: anchor.web3.PublicKey;
  config: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  startDate: number;
  treasury: anchor.web3.PublicKey;
  txTimeout: number;
}

const Home = (props: HomeProps) => {
  const [balance, setBalance] = useState<number>();
  const [isActive, setIsActive] = useState(false); // true when countdown completes
  const [isSoldOut, setIsSoldOut] = useState(false); // true when items remaining is zero
  const [isMinting, setIsMinting] = useState(false); // true when user got to press MINT

  const [itemsAvailable, setItemsAvailable] = useState(0);
  const [itemsRedeemed, setItemsRedeemed] = useState(0);
  const [itemsRemaining, setItemsRemaining] = useState(0);

  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: "",
    severity: undefined,
  });

  const [startDate, setStartDate] = useState(new Date(props.startDate));

  const wallet = useAnchorWallet();
  const [candyMachine, setCandyMachine] = useState<CandyMachine>();

  const refreshCandyMachineState = () => {
    (async () => {
      if (!wallet) return;

      const {
        candyMachine,
        goLiveDate,
        itemsAvailable,
        itemsRemaining,
        itemsRedeemed,
      } = await getCandyMachineState(
        wallet as anchor.Wallet,
        props.candyMachineId,
        props.connection
      );

      setItemsAvailable(itemsAvailable);
      setItemsRemaining(itemsRemaining);
      setItemsRedeemed(itemsRedeemed);

      setIsSoldOut(itemsRemaining === 0);
      setStartDate(goLiveDate);
      setCandyMachine(candyMachine);
    })();
  };

  const onMint = async () => {
    try {
      setIsMinting(true);
      if (wallet && candyMachine?.program) {
        const mintTxId = await mintToken(
          candyMachine,
          props.config,
          wallet.publicKey,
          props.treasury,
        );

        const status = await awaitTransactionSignatureConfirmation(
          mintTxId,
          props.txTimeout,
          props.connection,
          "singleGossip",
          false
        );

        if (!status?.err) {
          setAlertState({
            open: true,
            message: "Congratulations! Mint succeeded!",
            severity: "success",
          });
        } else {
          setAlertState({
            open: true,
            message: "Mint failed! Please try again!",
            severity: "error",
          });
        }
      }
    } catch (error: any) {
      // TODO: blech:
      let message = error.msg || "Minting failed! Please try again!";
      if (!error.msg) {
        if (error.message.indexOf("0x138")) {
        } else if (error.message.indexOf("0x137")) {
          message = `SOLD OUT!`;
        } else if (error.message.indexOf("0x135")) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          message = `SOLD OUT!`;
          setIsSoldOut(true);
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        }
      }

      setAlertState({
        open: true,
        message,
        severity: "error",
      });
    } finally {
      if (wallet) {
        const balance = await props.connection.getBalance(wallet.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      }
      setIsMinting(false);
      refreshCandyMachineState();
    }
  };

  const onMintMultiple = async (quantity: number) => {
    try {
      setIsMinting(true);
      if (wallet && candyMachine?.program) {
        const anchorWallet = {
          publicKey: wallet.publicKey,
          signAllTransactions: wallet.signAllTransactions,
          signTransaction: wallet.signTransaction,
        } as anchor.Wallet;
        const { candyMachine } =
          await getCandyMachineState(
            anchorWallet,
            props.candyMachineId,
            props.connection
          );
        if (candyMachine?.program && wallet.publicKey) {
          const oldBalance = await props.connection.getBalance(wallet?.publicKey) / LAMPORTS_PER_SOL;
          const futureBalance = oldBalance - (0.1 * quantity)

          const signedTransactions: any = await mintMultipleToken(
            candyMachine,
            props.config,
            wallet.publicKey,
            props.treasury,
            quantity
          );

          const promiseArray = []


          for (let index = 0; index < signedTransactions.length; index++) {
            const tx = signedTransactions[index];
            promiseArray.push(awaitTransactionSignatureConfirmation(
              tx,
              props.txTimeout,
              props.connection,
              "singleGossip",
              true
            ))
          }

          const allTransactionsResult = await Promise.all(promiseArray)
          let totalSuccess = 0;
          let totalFailure = 0;

          for (let index = 0; index < allTransactionsResult.length; index++) {
            const transactionStatus = allTransactionsResult[index];
            if (!transactionStatus?.err) {
              totalSuccess += 1
            } else {
              totalFailure += 1
            }
          }

          let newBalance = await props.connection.getBalance(wallet?.publicKey) / LAMPORTS_PER_SOL;

          while(newBalance > futureBalance) {
            await sleep(1000)
            newBalance = await props.connection.getBalance(wallet?.publicKey) / LAMPORTS_PER_SOL;
          }

          if(totalSuccess) {
            setAlertState({
              open: true,
              message: `Congratulations! ${totalSuccess} mints succeeded!`,
              severity: "success",
            });
          }

          if(totalFailure) {
            setAlertState({
              open: true,
              message: `Some mints failed! ${totalFailure} mints failed! Check on your wallet :(`,
              severity: "success",
            });
          }
        }
      }
    } catch (error: any) {
      let message = error.msg || "Minting failed! Please try again!";
      if (!error.msg) {
        if (error.message.indexOf("0x138")) {
        } else if (error.message.indexOf("0x137")) {
          message = `SOLD OUT!`;
        } else if (error.message.indexOf("0x135")) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          message = `SOLD OUT!`;
          setIsSoldOut(true);
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        }
      }
      setAlertState({
        open: true,
        message,
        severity: "error",
      });
    } finally {
      if (wallet?.publicKey) {
        const balance = await props.connection.getBalance(wallet?.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      }
      setIsMinting(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (wallet) {
        const balance = await props.connection.getBalance(wallet.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      }
    })();
  }, [wallet, props.connection]);

  useEffect(refreshCandyMachineState, [
    wallet,
    props.candyMachineId,
    props.connection,
  ]);

  return (
    <main style={{display: 'flex',  justifyContent:'center', alignItems:'center', flexDirection:'column', height: '100vh'}}>

      <div>
        <a href="https://twitter.com/JellyBabiesNFT" target="_blank" rel="noreferrer">
          <img src={twitterLogo} alt="twitter_logo" height="50" />
        </a>
      </div>

      <div className="header" style={{margin: '45px', fontSize: '100px', fontWeight: 'bold' }}>
        JELLYBABIES
      </div>

      <div style={{ fontSize: '28px', fontWeight: 'bold' }}>
        PHASE 2: 0.2 SOL PER MINT
      </div>

      <div>
        <img style={{ margin: '40px'}} src={jellyBabiesGIF} alt="jellybabies_gif" height="250" />
      </div>

      {wallet && (
        <p>Wallet {shortenAddress(wallet.publicKey.toBase58() || "")}</p>
      )}

      {/* {wallet && <p>Balance: {(balance || 0).toLocaleString()} SOL</p>} */}

      {/* {wallet && <p>Total Available: {itemsAvailable}</p>}

      {wallet && <p>Remaining: {itemsRemaining}</p>}

      {wallet && <p>Redeemed: {itemsRedeemed}</p>} */}

      {/* Phase 1 Display info */}
      {wallet && <p>Total Redeemed: {itemsRedeemed}</p>}

      {wallet && <p>Phase 2 Remaining: {2222 - itemsRedeemed}</p>}

      <MintContainer>
        {!wallet ? (
          <ConnectButton>Connect Wallet</ConnectButton>
        ) : (
          <div>
          {/* Mint 1 */}
          <MintButton
            style={{ margin: '10px'}}
            disabled={isSoldOut || isMinting || !isActive}
            onClick={onMint}
            variant="contained"
          >
            {isSoldOut ? (
              "SOLD OUT"
            ) : isActive ? (
              isMinting ? (
                <CircularProgress />
              ) : (
                "MINT 1"
              )
            ) : (
              <Countdown
                date={startDate}
                onMount={({ completed }) => completed && setIsActive(true)}
                onComplete={() => setIsActive(true)}
                renderer={renderCounter}
              />
            )}
          </MintButton>

          {/* Mint 5 */}
          <MintButton
            style={{ margin: '10px'}}
            disabled={isSoldOut || isMinting || !isActive}
            onClick={() => onMintMultiple(5)}
            variant="contained"
          >
            {isSoldOut ? (
              "SOLD OUT"
            ) : isActive ? (
              isMinting ? (
                <CircularProgress />
              ) : (
                "MINT 5"
              )
            ) : (
              <Countdown
                date={startDate}
                onMount={({ completed }) => completed && setIsActive(true)}
                onComplete={() => setIsActive(true)}
                renderer={renderCounter}
              />
            )}
          </MintButton>
          </div>
        )}
      </MintContainer>

      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </main>
  );
};

interface AlertState {
  open: boolean;
  message: string;
  severity: "success" | "info" | "warning" | "error" | undefined;
}

const renderCounter = ({ days, hours, minutes, seconds, completed }: any) => {
  return (
    <CounterText>
      {hours + (days || 0) * 24} hours, {minutes} minutes, {seconds} seconds
    </CounterText>
  );
};

export default Home;
